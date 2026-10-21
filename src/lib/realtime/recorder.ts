/**
 * Opt-in frame recorder and deterministic replay engine for the realtime
 * WebSocket stream.
 *
 * Closes #236: Captures the ordered sequence of realtime frames — including
 * connection lifecycle events and their wall-clock timestamps — during a live
 * or test session, then replays that recording deterministically against the
 * `RealtimeClient`'s subscription handlers. This turns "the navbar badge
 * flickered and claims stalled for a user yesterday" into a repeatable local
 * test case.
 *
 * ## Usage
 *
 * ### Capturing a recording
 * ```ts
 * import { frameRecorder } from "@/lib/realtime/recorder";
 * import { realtimeClient } from "@/lib/realtime/client";
 *
 * frameRecorder.start();
 * // … user does things …
 * const recording = frameRecorder.stop();
 * const json = serializeRecording(recording);
 * // Save `json` to a fixture file for later replay.
 * ```
 *
 * ### Replaying in a test
 * ```ts
 * import { replayRecording, deserializeRecording } from "@/lib/realtime/recorder";
 * import { RealtimeClient } from "@/lib/realtime/client";
 *
 * const recording = deserializeRecording(json);
 * const received: unknown[] = [];
 * const client = new RealtimeClient(); // or use the singleton
 * client.subscribe("oracle_update", (p) => received.push(p));
 * await replayRecording(recording, client);
 * // `received` now contains the same payloads as the original session.
 * ```
 */

import type { RealtimeFrame } from "./ringBuffer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A lifecycle event captured outside the normal topic/payload flow. */
export interface LifecycleEvent {
  kind: "lifecycle";
  event: string;
  data: Record<string, unknown>;
  timestamp: number;
  seq: number;
}

/** A data frame captured from the WebSocket message stream. */
export interface CapturedFrame {
  kind: "frame";
  topic: string;
  payload: unknown;
  receivedAt: number;
  seq: number;
}

export type RecordingEntry = LifecycleEvent | CapturedFrame;

export interface Recording {
  /** ISO-8601 timestamp of when recording started. */
  startedAt: string;
  /** ISO-8601 timestamp of when recording stopped. */
  stoppedAt: string;
  /** Ordered log of all captured entries. */
  entries: RecordingEntry[];
  /** Metadata bag for annotating recordings (session ID, user agent, etc.). */
  meta: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// FrameRecorder
// ---------------------------------------------------------------------------

export class FrameRecorder {
  private active = false;
  private entries: RecordingEntry[] = [];
  private startedAt: string | null = null;
  private _seq = 0;

  /** Begin capturing frames and lifecycle events. Idempotent. */
  start(meta: Record<string, unknown> = {}): void {
    if (this.active) return;
    this.active = true;
    this.entries = [];
    this._seq = 0;
    this.startedAt = new Date().toISOString();
    this._meta = meta;
  }

  private _meta: Record<string, unknown> = {};

  /** Whether recording is currently active. */
  get isRecording(): boolean {
    return this.active;
  }

  /**
   * Stop capturing and return the completed `Recording`.
   * Recording is cleared from memory — call `start()` again for a new session.
   */
  stop(): Recording {
    this.active = false;
    const rec: Recording = {
      startedAt: this.startedAt ?? new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
      entries: this.entries.slice(),
      meta: { ...this._meta },
    };
    this.entries = [];
    this.startedAt = null;
    this._seq = 0;
    return rec;
  }

  /**
   * Record a data frame received from the WebSocket.
   * No-op when recording is not active.
   */
  recordFrame(frame: RealtimeFrame): void {
    if (!this.active) return;
    this.entries.push({
      kind: "frame",
      topic: frame.topic,
      payload: frame.payload,
      receivedAt: frame.receivedAt,
      seq: this._seq++,
    });
  }

  /**
   * Record a connection lifecycle event (connect, open, close, etc.).
   * No-op when recording is not active.
   */
  recordLifecycle(event: string, data: Record<string, unknown>): void {
    if (!this.active) return;
    this.entries.push({
      kind: "lifecycle",
      event,
      data,
      timestamp: Date.now(),
      seq: this._seq++,
    });
  }

  /** Non-destructive peek at entries collected so far (while recording). */
  peek(): RecordingEntry[] {
    return this.entries.slice();
  }
}

/** Module-level singleton shared with `RealtimeClient`. */
export const frameRecorder = new FrameRecorder();

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

/** Serialise a `Recording` to a JSON string for fixture storage. */
export function serializeRecording(recording: Recording): string {
  return JSON.stringify(recording, null, 2);
}

/** Deserialise a JSON string produced by `serializeRecording`. */
export function deserializeRecording(json: string): Recording {
  const parsed = JSON.parse(json) as Recording;
  if (!Array.isArray(parsed.entries)) {
    throw new TypeError("Invalid recording: `entries` must be an array");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Replay engine
// ---------------------------------------------------------------------------

/** Minimal subset of `RealtimeClient` needed for replay. */
export interface ReplayTarget {
  /** Internal handlers map — we drive it directly for deterministic replay. */
  readonly _handlers?: Map<string, Set<(payload: unknown) => void>>;
  /** Public subscribe API (used to wire up test handlers before replay). */
  subscribe(topic: string, handler: (payload: unknown) => void): () => void;
}

/**
 * Internal: dispatch a `CapturedFrame` to all matching handlers on `target`.
 * Accesses the private `_handlers` map when available to avoid triggering
 * connect/lifecycle side-effects during replay; falls back to no-op if the
 * internal map isn't accessible (e.g. a proxy or mock object without it).
 */
function dispatchToHandlers(target: ReplayTarget, frame: CapturedFrame): void {
  // Access internal handler map directly so replay never opens a real socket.
  // In tests, the client under replay is typically a fresh instance that has
  // had subscribe() called on it but connect() never called.
  const handlers = (target as unknown as { handlers: Map<string, Set<(p: unknown) => void>> })
    .handlers;
  if (handlers instanceof Map) {
    handlers.get(frame.topic)?.forEach((h) => h(frame.payload));
  }
}

export interface ReplayOptions {
  /**
   * When true (default), each frame is delivered with a `setTimeout` delay
   * matching the original inter-frame timing. Set to `false` for synchronous,
   * wall-clock-independent tests.
   */
  preserveTiming?: boolean;
  /**
   * Speed multiplier applied to all delays when `preserveTiming` is true.
   * 1.0 = real time, 10.0 = 10× faster, 0.1 = 10× slower. Default: 1.0.
   */
  speed?: number;
  /**
   * Callback fired for lifecycle entries so tests can assert on connection
   * events without coupling to OTel/recorder internals.
   */
  onLifecycle?: (event: LifecycleEvent) => void;
}

/**
 * Replay a `Recording` against a `ReplayTarget`.
 *
 * Frames are dispatched in the order they were captured. Lifecycle events
 * call `options.onLifecycle` (if provided). Timing between entries can be
 * preserved at the original wall-clock speed (or scaled via `speed`).
 *
 * Returns a Promise that resolves when all entries have been dispatched.
 */
export async function replayRecording(
  recording: Recording,
  target: ReplayTarget,
  options: ReplayOptions = {}
): Promise<void> {
  const { preserveTiming = true, speed = 1.0, onLifecycle } = options;

  const entries = recording.entries.slice().sort((a, b) => a.seq - b.seq);
  if (entries.length === 0) return;

  // Build an absolute→relative timing map for timing-aware replay.
  const firstTimestamp = entries[0].kind === "frame" ? entries[0].receivedAt : entries[0].timestamp;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (preserveTiming && i > 0) {
      const prevEntry = entries[i - 1];
      const prevTs = prevEntry.kind === "frame" ? prevEntry.receivedAt : prevEntry.timestamp;
      const currTs = entry.kind === "frame" ? entry.receivedAt : entry.timestamp;
      const delay = Math.max(0, (currTs - prevTs) / speed);
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }

    if (entry.kind === "frame") {
      dispatchToHandlers(target, entry);
    } else {
      onLifecycle?.(entry);
    }
  }

  void firstTimestamp; // referenced above
}

/**
 * Synchronous replay — delivers all data frames immediately without any
 * `setTimeout` pauses. Lifecycle events still call `onLifecycle` synchronously.
 * Preferred for unit tests where wall-clock reproducibility is not needed.
 */
export function replaySync(
  recording: Recording,
  target: ReplayTarget,
  options: Omit<ReplayOptions, "preserveTiming" | "speed"> = {}
): void {
  const entries = recording.entries.slice().sort((a, b) => a.seq - b.seq);
  for (const entry of entries) {
    if (entry.kind === "frame") {
      dispatchToHandlers(target, entry);
    } else {
      options.onLifecycle?.(entry);
    }
  }
}

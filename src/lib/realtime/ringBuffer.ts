/**
 * Bounded, per-topic in-memory ring buffer for realtime frames.
 *
 * Closes #253: A high-frequency or misbehaving WebSocket stream must not
 * grow client memory without limit. This module provides a fixed-capacity,
 * O(1) push/drain ring buffer and a per-topic buffer registry that the
 * realtime client uses to store received frames before dispatching them to
 * subscribers.
 *
 * Documented caps (all tuneable via RingBufferOptions):
 *   DEFAULT_CAPACITY  = 256 frames per topic (≈ ~50 kB worst-case per topic
 *                       assuming a 200-byte JSON payload; negligible for
 *                       typical payloads).
 *   MAX_GLOBAL_TOPICS = 64 topics (prevents unbounded map growth if an
 *                       attacker or bug introduces an unbounded topic space).
 *
 * When the buffer is full the oldest frame is silently evicted (FIFO drop).
 * Frames are never kept longer than necessary: `drain()` atomically removes
 * and returns all buffered frames, leaving the buffer empty.
 */

export interface RealtimeFrame<T = unknown> {
  /** WebSocket topic identifier (e.g. "oracle_update"). */
  topic: string;
  /** The parsed message payload. */
  payload: T;
  /** Wall-clock timestamp (Date.now()) when the frame was received. */
  receivedAt: number;
  /** Monotonically increasing sequence number within the session (for replay ordering). */
  seq: number;
}

export interface RingBufferOptions {
  /** Maximum frames to hold before evicting the oldest. Default: 256. */
  capacity?: number;
}

/** Default number of frames retained per topic. */
export const DEFAULT_CAPACITY = 256;
/** Hard upper limit on the number of distinct topics tracked. */
export const MAX_GLOBAL_TOPICS = 64;

/**
 * Fixed-capacity FIFO ring buffer for `RealtimeFrame` objects.
 *
 * Memory layout: a fixed-size array with a write-head pointer that wraps
 * modulo `capacity`. This avoids splice/shift overhead and ensures a strictly
 * bounded allocation.
 */
export class RingBuffer<T = unknown> {
  private readonly buf: (RealtimeFrame<T> | undefined)[];
  private head = 0; // Points to the next write position.
  private _size = 0;

  readonly capacity: number;

  constructor(options: RingBufferOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    if (this.capacity < 1) throw new RangeError("RingBuffer capacity must be ≥ 1");
    this.buf = new Array(this.capacity);
  }

  /** Number of frames currently held (0 ≤ size ≤ capacity). */
  get size(): number {
    return this._size;
  }

  /** True when no more frames can be added without evicting an old one. */
  get isFull(): boolean {
    return this._size === this.capacity;
  }

  /**
   * Push a frame onto the buffer.
   * If the buffer is full the oldest frame is silently overwritten (FIFO eviction).
   * Returns the evicted frame if one was dropped, `undefined` otherwise.
   */
  push(frame: RealtimeFrame<T>): RealtimeFrame<T> | undefined {
    let evicted: RealtimeFrame<T> | undefined;
    if (this._size === this.capacity) {
      evicted = this.buf[this.head];
    } else {
      this._size++;
    }
    this.buf[this.head] = frame;
    this.head = (this.head + 1) % this.capacity;
    return evicted;
  }

  /**
   * Return all buffered frames in insertion order and clear the buffer.
   * This is an atomic read-and-clear — callers that want replay semantics
   * should use `snapshot()` instead.
   */
  drain(): RealtimeFrame<T>[] {
    return this._collect(true);
  }

  /**
   * Return all buffered frames in insertion order without clearing.
   * Useful for replay / contract tests that need to inspect state
   * non-destructively.
   */
  snapshot(): RealtimeFrame<T>[] {
    return this._collect(false);
  }

  /** Remove all frames from the buffer. */
  clear(): void {
    this.buf.fill(undefined as unknown as RealtimeFrame<T>);
    this.head = 0;
    this._size = 0;
  }

  private _collect(clear: boolean): RealtimeFrame<T>[] {
    if (this._size === 0) return [];
    const tail = (this.head - this._size + this.capacity) % this.capacity;
    const out: RealtimeFrame<T>[] = new Array(this._size);
    for (let i = 0; i < this._size; i++) {
      out[i] = this.buf[(tail + i) % this.capacity] as RealtimeFrame<T>;
    }
    if (clear) this.clear();
    return out;
  }
}

/**
 * Per-topic ring-buffer registry.
 *
 * A single registry instance is shared by `RealtimeClient` to hold the
 * most-recent frames for each known topic. Access is synchronous and O(1)
 * per operation.
 *
 * Topic capacity can be overridden per-topic; topics not listed in
 * `topicCapacities` use `defaultCapacity`.
 */
export interface RegistryOptions {
  /** Fallback capacity for topics not named in `topicCapacities`. */
  defaultCapacity?: number;
  /** Per-topic capacity overrides. */
  topicCapacities?: Record<string, number>;
  /**
   * Maximum number of distinct topics the registry will track.
   * New topics beyond this limit are silently dropped. Default: MAX_GLOBAL_TOPICS.
   */
  maxTopics?: number;
}

export class TopicRegistry {
  private readonly buffers = new Map<string, RingBuffer>();
  private readonly defaultCapacity: number;
  private readonly topicCapacities: Record<string, number>;
  private readonly maxTopics: number;
  private _seq = 0;
  /** Total frames that were dropped because maxTopics was reached. */
  droppedTopics = 0;

  constructor(options: RegistryOptions = {}) {
    this.defaultCapacity = options.defaultCapacity ?? DEFAULT_CAPACITY;
    this.topicCapacities = options.topicCapacities ?? {};
    this.maxTopics = options.maxTopics ?? MAX_GLOBAL_TOPICS;
  }

  /**
   * Record a received frame in the appropriate topic buffer.
   * Returns the frame that was stored (with seq assigned), or `undefined` if
   * the registry has reached `maxTopics` and the topic is new.
   */
  record(topic: string, payload: unknown): RealtimeFrame | undefined {
    if (!this.buffers.has(topic)) {
      if (this.buffers.size >= this.maxTopics) {
        this.droppedTopics++;
        return undefined;
      }
      const cap = this.topicCapacities[topic] ?? this.defaultCapacity;
      this.buffers.set(topic, new RingBuffer({ capacity: cap }));
    }
    const frame: RealtimeFrame = {
      topic,
      payload,
      receivedAt: Date.now(),
      seq: this._seq++,
    };
    this.buffers.get(topic)!.push(frame);
    return frame;
  }

  /** Return a snapshot (non-destructive read) of all frames for a topic. */
  snapshot(topic: string): RealtimeFrame[] {
    return this.buffers.get(topic)?.snapshot() ?? [];
  }

  /** Drain (read-and-clear) all frames for a topic. */
  drain(topic: string): RealtimeFrame[] {
    return this.buffers.get(topic)?.drain() ?? [];
  }

  /** Drain all topics and return a flat, seq-ordered array of all frames. */
  drainAll(): RealtimeFrame[] {
    const all: RealtimeFrame[] = [];
    for (const buf of this.buffers.values()) {
      all.push(...buf.drain());
    }
    return all.sort((a, b) => a.seq - b.seq);
  }

  /** Return a non-destructive snapshot of all topics. */
  snapshotAll(): RealtimeFrame[] {
    const all: RealtimeFrame[] = [];
    for (const buf of this.buffers.values()) {
      all.push(...buf.snapshot());
    }
    return all.sort((a, b) => a.seq - b.seq);
  }

  /** Names of topics currently tracked (in insertion order). */
  get topics(): string[] {
    return Array.from(this.buffers.keys());
  }

  /** Clear all buffers and reset the global sequence counter. */
  reset(): void {
    this.buffers.clear();
    this._seq = 0;
    this.droppedTopics = 0;
  }

  /** How many frames have been buffered globally (across all topics). */
  get totalBuffered(): number {
    let n = 0;
    for (const buf of this.buffers.values()) n += buf.size;
    return n;
  }

  /** Current global sequence counter (total frames ever recorded). */
  get seq(): number {
    return this._seq;
  }
}

import { API_BASE_URL } from "@/lib/api/client";

type Handler = (payload: unknown) => void;

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const CURSOR_STORAGE_PREFIX = "realtime:cursor:";
const MAX_REPORTED_RECONNECT_LOOPS = 5;

/**
 * Machine-readable connection status the UI can branch on.
 * - `idle`: never connected / explicitly disconnected
 * - `connecting`: initial connection in flight
 * - `open`: connected and healthy
 * - `reconnecting`: dropped, waiting to retry
 * - `closed`: closed by the user
 */
export type RealtimeStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface RealtimeHealth {
  status: RealtimeStatus;
  /** Transport currently in use, e.g. "websocket". */
  transport: string;
  /** Number of reconnect attempts since the last successful open. */
  attempt: number;
  /** Epoch ms of the last message received, or null if none yet. */
  lastMessageAt: number | null;
  /** Age in ms of the last message, or null if none yet. */
  lastMessageAgeMs: number | null;
  /** Last error surfaced by the transport, redacted for reporting. */
  lastError: string | null;
  /** Cumulative count of transport errors observed. */
  errorCount: number;
}

type HealthListener = (health: RealtimeHealth) => void;

/**
 * A single observed realtime message, captured for the dev inspector.
 * `direction` is `in` for messages received from the server and `out` for
 * subscribe frames sent by the client.
 */
export interface RealtimeInspectorEvent {
  id: number;
  topic: string;
  seq: number | null;
  direction: "in" | "out";
  timestamp: number;
  payload: unknown;
}

type InspectorListener = (events: RealtimeInspectorEvent[]) => void;

/**
 * Strips tokens/URLs from error strings before they leave the client so
 * health signals can be safely forwarded to error monitoring.
 */
function redactError(message: string): string {
  return message
    .replace(/wss?:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/(token|access_token|auth|key|secret)=[^&\s"']+/gi, "$1=[redacted]");
}

/**
 * A small reconnecting WebSocket wrapper exposing a subscribe-by-topic API.
 * The backend contract this assumes (documented, not yet implemented
 * upstream): connect to `${wsUrl}`, receive JSON messages shaped
 * `{ topic: string, payload: unknown, seq?: number }`, one topic per
 * push-based update type (e.g. "oracle_update"). Callers must treat this
 * connection as best-effort — always keep an independent REST fetch as the
 * source of truth for initial state.
 *
 * Snapshot-and-resume: the last-applied sequence per topic is persisted and
 * sent as a `since` cursor on (re)subscribe so the server can replay missed
 * events. On reconnect the client first refetches the REST snapshot for the
 * topic, then replays any events newer than the stored cursor through the
 * idempotent merge layer. If replay is unavailable or the cursor is too old,
 * it falls back to a fresh snapshot with no streamed delta.
 *
 * Health: the client maintains an observable health snapshot emitted to
 * subscribers on state transitions (not per-message) so React can subscribe
 * rather than poll. High-frequency message timestamps are coalesced.
 *
 * Inspector: a dev-only tap point exposes a bounded ring buffer of recent
 * messages (raw in/out frames) to the dev inspector panel. It is a passive
 * observer — subscribing to it never triggers a (re)subscribe on the socket.
 */
class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private cursors = new Map<string, number>();
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private health: RealtimeHealth = {
    status: "idle",
    transport: "websocket",
    attempt: 0,
    lastMessageAt: null,
    lastMessageAgeMs: null,
    lastError: null,
    errorCount: 0,
  };
  private healthListeners = new Set<HealthListener>();
  private messageCoalesceTimer: ReturnType<typeof setTimeout> | null = null;
  private reportedReconnectLoops = 0;

  private inspectorEvents: RealtimeInspectorEvent[] = [];
  private inspectorListeners = new Set<InspectorListener>();
  private inspectorSeq = 0;
  private static readonly INSPECTOR_MAX_EVENTS = 100;

  connect(): void {
    if (typeof WebSocket === "undefined" || this.socket) return;
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    const wsUrl = API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1$/, "/ws");
    this.updateHealth({ status: this.attempt > 0 ? "reconnecting" : "connecting" });
    try {
      this.socket = new WebSocket(wsUrl);
    } catch (err) {
      this.recordError(err);
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener("open", () => {
      this.attempt = 0;
      this.reportedReconnectLoops = 0;
      this.updateHealth({ status: "open", attempt: 0 });
      this.resubscribe();
    });
    this.socket.addEventListener("message", (event) => {
      try {
        const { topic, payload, seq } = JSON.parse(event.data as string) as {
          topic: string;
          payload: unknown;
          seq?: number;
        };
        if (typeof seq === "number") this.setCursor(topic, seq);
        this.recordInspectorEvent({
          topic,
          seq: typeof seq === "number" ? seq : null,
          direction: "in",
          payload,
        });
        this.handlers.get(topic)?.forEach((handler) => handler(payload));
        this.markMessageReceived();
      } catch {
        // Malformed message — ignore, don't crash the connection.
      }
    });
    this.socket.addEventListener("close", () => {
      this.socket = null;
      if (!this.closedByUser) {
        this.updateHealth({ status: "reconnecting" });
        this.scheduleReconnect();
      }
    });
    this.socket.addEventListener("error", (event) => {
      this.recordError(event);
      this.socket?.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.updateHealth({ status: "reconnecting", attempt: this.attempt });
    this.reportReconnectLoop();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.open();
    }, delay);
  }

  private resubscribe(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    for (const topic of this.handlers.keys()) {
      const since = this.cursors.get(topic);
      this.sendSubscribe(topic, since);
    }
  }

  private sendSubscribe(topic: string, since: number | undefined): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "subscribe", topic, since }));
    this.recordInspectorEvent({
      topic,
      seq: typeof since === "number" ? since : null,
      direction: "out",
      payload: { type: "subscribe", topic, since },
    });
  }

  private setCursor(topic: string, seq: number): void {
    const current = this.cursors.get(topic);
    if (current !== undefined && seq <= current) return;
    this.cursors.set(topic, seq);
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(`${CURSOR_STORAGE_PREFIX}${topic}`, String(seq));
      }
    } catch {
      // Storage unavailable — in-memory cursor still works for this session.
    }
  }

  private loadCursor(topic: string): number | undefined {
    const inMemory = this.cursors.get(topic);
    if (inMemory !== undefined) return inMemory;
    try {
      if (typeof sessionStorage !== "undefined") {
        const raw = sessionStorage.getItem(`${CURSOR_STORAGE_PREFIX}${topic}`);
        if (raw !== null) {
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) {
            this.cursors.set(topic, parsed);
            return parsed;
          }
        }
      }
    } catch {
      // Storage unavailable — fall through to no cursor.
    }
    return undefined;
  }

  /**
   * Returns the last-applied cursor for a topic, if any. Consumers use this
   * to request a REST snapshot and replay events newer than the cursor.
   */
  getCursor(topic: string): number | undefined {
    return this.loadCursor(topic);
  }

  /**
   * Clears the stored cursor for a topic. Call this when falling back to a
   * fresh snapshot because replay is unavailable or the cursor is too old.
   */
  resetCursor(topic: string): void {
    this.cursors.delete(topic);
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem(`${CURSOR_STORAGE_PREFIX}${topic}`);
      }
    } catch {
      // Storage unavailable — nothing to clear.
    }
  }

  /**
   * Dev-only tap point: records a message into the bounded inspector ring
   * buffer and notifies inspector listeners with a stable snapshot. This is
   * a passive observer and never touches the socket or subscriptions.
   */
  private recordInspectorEvent(
    event: Omit<RealtimeInspectorEvent, "id" | "timestamp">,
  ): void {
    if (this.inspectorListeners.size === 0) return;
    this.inspectorSeq += 1;
    const entry: RealtimeInspectorEvent = {
      ...event,
      id: this.inspectorSeq,
      timestamp: Date.now(),
    };
    const next = [...this.inspectorEvents, entry];
    this.inspectorEvents =
      next.length > RealtimeClient.INSPECTOR_MAX_EVENTS
        ? next.slice(next.length - RealtimeClient.INSPECTOR_MAX_EVENTS)
        : next;
    const snapshot = this.inspectorEvents;
    this.inspectorListeners.forEach((listener) => listener(snapshot));
  }

  /**
   * Subscribes to the dev inspector event stream. Returns the current
   * snapshot immediately and an unsubscribe function. Does not open or
   * resubscribe the socket.
   */
  subscribeInspector(listener: InspectorListener): () => void {
    this.inspectorListeners.add(listener);
    listener(this.inspectorEvents);
    return () => {
      this.inspectorListeners.delete(listener);
    };
  }

  subscribe(topic: string, handler: Handler): () => void {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler);
    this.loadCursor(topic);
    this.connect();

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.sendSubscribe(topic, this.cursors.get(topic));
    }

    return () => {
      this.handlers.get(topic)?.delete(handler);
    };
  }
}

export const realtimeClient = new RealtimeClient();

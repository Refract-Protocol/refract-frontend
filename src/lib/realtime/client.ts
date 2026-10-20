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
      this.socket.send(JSON.stringify({ type: "subscribe", topic, since }));
    }
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

  subscribe(topic: string, handler: Handler): () => void {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler);
    this.loadCursor(topic);
    this.connect();

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const since = this.cursors.get(topic);
      this.socket.send(JSON.stringify({ type: "subscribe", topic, since }));
    }

    return () => {
      this.handlers.get(topic)?.delete(handler);
    };
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    this.updateHealth({ status: "closed" });
  }

  /**
   * Subscribe to connection health. Emits the current snapshot immediately,
   * then on each state transition. Returns an unsubscribe function.
   */
  subscribeHealth(listener: HealthListener): () => void {
    this.healthListeners.add(listener);
    listener(this.getHealth());
    return () => {
      this.healthListeners.delete(listener);
    };
  }

  /** Returns a copy of the current health snapshot. */
  getHealth(): RealtimeHealth {
    return {
      ...this.health,
      lastMessageAgeMs:
        this.health.lastMessageAt === null ? null : Date.now() - this.health.lastMessageAt,
    };
  }

  private updateHealth(patch: Partial<RealtimeHealth>): void {
    this.health = { ...this.health, ...patch };
    const snapshot = this.getHealth();
    this.healthListeners.forEach((listener) => listener(snapshot));
  }

  /**
   * Coalesces high-frequency message timestamps so per-message traffic does
   * not churn React state on every frame.
   */
  private markMessageReceived(): void {
    if (this.messageCoalesceTimer) return;
    this.messageCoalesceTimer = setTimeout(() => {
      this.messageCoalesceTimer = null;
      this.updateHealth({ lastMessageAt: Date.now() });
    }, 1_000);
  }

  private recordError(err: unknown): void {
    const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "transport error";
    this.updateHealth({
      lastError: redactError(raw),
      errorCount: this.health.errorCount + 1,
    });
  }

  /**
   * Reports reconnect-loop events to error monitoring, capped to avoid alert
   * flooding during a sustained outage.
   */
  private reportReconnectLoop(): void {
    if (this.reportedReconnectLoops >= MAX_REPORTED_RECONNECT_LOOPS) return;
    this.reportedReconnectLoops += 1;
    const report = (globalThis as { __realtimeHealthReport?: (h: RealtimeHealth) => void })
      .__realtimeHealthReport;
    if (typeof report === "function") {
      try {
        report(this.getHealth());
      } catch {
        // Monitoring must never break the connection.
      }
    }
  }
}

export const realtimeClient = new RealtimeClient();

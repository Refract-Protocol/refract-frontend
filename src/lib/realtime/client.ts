import { API_BASE_URL } from "@/lib/api/client";

type Handler = (payload: unknown) => void;

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const CURSOR_STORAGE_PREFIX = "realtime:cursor:";

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
 */
class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private cursors = new Map<string, number>();
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    if (typeof WebSocket === "undefined" || this.socket) return;
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    const wsUrl = API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1$/, "/ws");
    try {
      this.socket = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener("open", () => {
      this.attempt = 0;
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
      } catch {
        // Malformed message — ignore, don't crash the connection.
      }
    });
    this.socket.addEventListener("close", () => {
      this.socket = null;
      if (!this.closedByUser) this.scheduleReconnect();
    });
    this.socket.addEventListener("error", () => {
      this.socket?.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
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
  }
}

export const realtimeClient = new RealtimeClient();

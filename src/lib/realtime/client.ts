import { API_BASE_URL } from "@/lib/api/client";

type Handler = (payload: unknown) => void;
export type RealtimeErrorHandler = (error: Error) => void;

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

/**
 * A small reconnecting WebSocket wrapper exposing a subscribe-by-topic API.
 * The backend contract this assumes (documented, not yet implemented
 * upstream): connect to `${wsUrl}`, receive JSON messages shaped
 * `{ topic: string, payload: unknown }`, one topic per push-based update
 * type (e.g. "oracle_update"). Callers must treat this connection as
 * best-effort — always keep an independent REST fetch as the source of
 * truth for initial state.
 */
class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private errors = new Map<string, Set<RealtimeErrorHandler>>();
  private degraded = new Set<string>();

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
    });
    this.socket.addEventListener("message", (event) => {
      try {
        const { topic, payload } = JSON.parse(event.data as string) as { topic: string; payload: unknown };
        if (typeof topic !== "string") return;
        this.handlers.get(topic)?.forEach((handler) => {
          try { handler(payload); } catch (error) {
            this.report(topic, error instanceof Error ? error : new Error("Realtime handler failed"));
          }
        });
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

  subscribe(topic: string, handler: Handler): () => void {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler);
    this.connect();

    return () => {
      this.handlers.get(topic)?.delete(handler);
    };
  }

  onError(topic: string, handler: RealtimeErrorHandler): () => void {
    if (!this.errors.has(topic)) this.errors.set(topic, new Set());
    this.errors.get(topic)!.add(handler);
    return () => this.errors.get(topic)?.delete(handler);
  }

  markDegraded(topic: string, error?: Error, route = "unknown"): void {
    if (this.degraded.has(topic)) return;
    this.degraded.add(topic);
    if (error) console.error("Realtime topic degraded", { topic, route, transport: "websocket", error: error.name });
    this.errors.get(topic)?.forEach((handler) => handler(error ?? new Error("Realtime topic degraded")));
  }

  retry(topic: string): void { this.degraded.delete(topic); }
  isDegraded(topic: string): boolean { return this.degraded.has(topic); }

  private report(topic: string, error: Error, route = "unknown"): void {
    // Context only: never include a payload or address in diagnostic output.
    this.markDegraded(topic, error, route);
  }

  /** Deterministic entry point used by local benchmark and unit harnesses. */
  dispatch(topic: string, payload: unknown): void {
    this.handlers.get(topic)?.forEach((handler) => handler(payload));
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }
}

export const realtimeClient = new RealtimeClient();

import { API_BASE_URL } from "@/lib/api/client";
import { isTopicEnabled, onTopicFlagChange } from "./flags";

type Handler = (payload: unknown) => void;

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
  /** Handlers for flag-disabled topics: held in memory only, never on the socket. */
  private parked = new Map<string, Set<Handler>>();
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    onTopicFlagChange((topic, enabled) => {
      if (enabled) {
        const parked = this.parked.get(topic);
        if (!parked?.size) return;
        this.parked.delete(topic);
        parked.forEach((handler) => this.attach(topic, handler));
      } else {
        const live = this.handlers.get(topic);
        if (!live) return;
        this.handlers.delete(topic);
        if (live.size) this.parked.set(topic, live);
        if (this.handlers.size === 0) this.disconnect();
      }
    });
  }

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

  /**
   * Disabled topics never open a subscription: the handler is parked (so a
   * mid-session enable can activate it) and callers keep using their REST path.
   */
  subscribe(topic: string, handler: Handler): () => void {
    if (isTopicEnabled(topic)) this.attach(topic, handler);
    else this.park(topic, handler);

    return () => {
      this.handlers.get(topic)?.delete(handler);
      this.parked.get(topic)?.delete(handler);
    };
  }

  private park(topic: string, handler: Handler): void {
    if (!this.parked.has(topic)) this.parked.set(topic, new Set());
    this.parked.get(topic)!.add(handler);
  }

  private attach(topic: string, handler: Handler): void {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler);
    this.connect();
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }
}

export const realtimeClient = new RealtimeClient();

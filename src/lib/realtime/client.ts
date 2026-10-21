import { API_BASE_URL } from "@/lib/api/client";
import { realtimeLogger, summarizeRealtimeValue } from "./redact";

export interface RealtimeUpdate<T = unknown> {
  payload: T;
  sequence?: number;
  timestamp?: number;
}
type Handler = (update: RealtimeUpdate) => void;

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

/** Best-effort WebSocket transport. REST remains responsible for initial data and fallback. */
class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
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
    } catch (error) {
      realtimeLogger.warn("connection failed", { error });
      this.scheduleReconnect();
      return;
    }
    this.socket.addEventListener("open", () => {
      this.attempt = 0;
    });
    this.socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data as string) as {
          topic?: unknown;
          payload?: unknown;
          sequence?: unknown;
          timestamp?: unknown;
        };
        if (typeof message.topic !== "string" || !("payload" in message)) return;
        const update: RealtimeUpdate = {
          payload: message.payload,
          sequence:
            typeof message.sequence === "number" && Number.isFinite(message.sequence)
              ? message.sequence
              : undefined,
          timestamp:
            typeof message.timestamp === "number" && Number.isFinite(message.timestamp)
              ? message.timestamp
              : typeof message.timestamp === "string" &&
                  Number.isFinite(Date.parse(message.timestamp))
                ? Date.parse(message.timestamp)
                : undefined,
        };
        const safeTopic = /^[a-z.]+$/.test(message.topic) ? message.topic : "[scoped topic]";
        realtimeLogger.debug("message received", {
          topic: safeTopic,
          ...summarizeRealtimeValue(update.payload),
        });
        this.handlers.get(message.topic)?.forEach((handler) => handler(update));
      } catch (error) {
        realtimeLogger.warn("malformed message", { error });
      }
    });
    this.socket.addEventListener("close", () => {
      this.socket = null;
      if (!this.closedByUser) this.scheduleReconnect();
    });
    this.socket.addEventListener("error", () => this.socket?.close());
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

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }
}

export const realtimeClient = new RealtimeClient();

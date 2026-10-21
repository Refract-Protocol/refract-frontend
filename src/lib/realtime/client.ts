import { API_BASE_URL } from "@/lib/api/client";
import { applyFrame, isRejection, isTopicFrame, type TopicState } from "./patch";

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
  private attempt = 0;
  private closedByUser = false;
  private topicState = new Map<string, TopicState>();
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
    });
    this.socket.addEventListener("message", (event) => {
      try {
        const { topic, payload } = JSON.parse(event.data as string) as {
          topic: string;
          payload: unknown;
        };
        this.dispatch(topic, payload);
      } catch {
        // Malformed message — ignore, don't crash the connection.
      }
    });
    this.socket.addEventListener("close", () => {
      this.socket = null;
      this.topicState.clear();
      if (!this.closedByUser) this.scheduleReconnect();
    });
    this.socket.addEventListener("error", () => {
      this.socket?.close();
    });
  }

  /**
   * Snapshot/patch frames (contract v2) are folded into per-topic state and
   * handlers receive the resulting data; any other payload is passed through
   * unchanged so topics can opt in to deltas independently.
   */
  private dispatch(topic: string, payload: unknown): void {
    let out = payload;
    if (isTopicFrame(payload)) {
      const result = applyFrame(this.topicState.get(topic) ?? null, payload);
      if (isRejection(result)) {
        if (result.resync && this.socket?.readyState === WebSocket.OPEN) {
          this.topicState.delete(topic);
          this.socket.send(JSON.stringify({ type: "resync", topic }));
        }
        return;
      }
      this.topicState.set(topic, result);
      out = result.data;
    }
    this.handlers.get(topic)?.forEach((handler) => handler(out));
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

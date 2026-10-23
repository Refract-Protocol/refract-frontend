import { API_BASE_URL } from "@/lib/api/client";
import { applyFrame, isRejection, isTopicFrame, type TopicState } from "./patch";
import { LastValueCache, normalizeTopic, type CachedValue } from "./lastValueCache";

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
  private cache = new LastValueCache();

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
    const key = normalizeTopic(topic);
    let out = payload;
    if (isTopicFrame(payload)) {
      const result = applyFrame(this.topicState.get(key) ?? null, payload);
      if (isRejection(result)) {
        if (result.resync && this.socket?.readyState === WebSocket.OPEN) {
          this.topicState.delete(key);
          this.socket.send(JSON.stringify({ type: "resync", topic: key }));
        }
        return;
      }
      this.topicState.set(key, result);
      out = result.data;
    }
    this.publish(key, out);
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
   * Single dispatch path for every source (WebSocket, Soroban events, mocks):
   * the last-value cache is written before subscribers are notified so a
   * subscriber mounting from inside a handler never reads an older value.
   */
  publish(topic: string, payload: unknown, source = "ws", sequence?: number): void {
    const key = normalizeTopic(topic);
    this.cache.set(key, payload, source, sequence);
    this.handlers.get(key)?.forEach((handler) => handler(payload));
  }

  /** Synchronous read of the latest pushed value for a topic, if still fresh. */
  getLastValue<T = unknown>(topic: string): CachedValue<T> | undefined {
    return this.cache.get<T>(topic);
  }

  /** Call on account switch or network switch. */
  clearCache(): void {
    this.cache.clear();
  }

  subscribe(topic: string, handler: Handler): () => void {
    const key = normalizeTopic(topic);
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler);
    this.connect();

    return () => {
      this.handlers.get(key)?.delete(handler);
    };
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    this.cache.clear();
  }
}

export const realtimeClient = new RealtimeClient();

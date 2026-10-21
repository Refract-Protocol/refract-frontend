import { API_BASE_URL } from "@/lib/api/client";
import { RingBuffer } from "./ringBuffer";
import { REALTIME_TOPICS, TOPIC_BUFFER_CAPS, type RealtimeTopic } from "./topics";

type Handler = (payload: unknown) => void;

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

/** Default buffer capacity for topics not listed in TOPIC_BUFFER_CAPS. */
const DEFAULT_BUFFER_CAP = 50;

/**
 * A small reconnecting WebSocket wrapper exposing a subscribe-by-topic API.
 * The backend contract this assumes (documented, not yet implemented
 * upstream): connect to `${wsUrl}`, receive JSON messages shaped
 * `{ topic: string, payload: unknown }`, one topic per push-based update
 * type (e.g. "oracle_update"). Callers must treat this connection as
 * best-effort — always keep an independent REST fetch as the source of
 * truth for initial state.
 *
 * Each topic is backed by a bounded {@link RingBuffer} so a high-frequency
 * or misbehaving stream cannot grow client memory without limit. The buffer
 * cap is documented per topic in {@link TOPIC_BUFFER_CAPS} and defaults to
 * 50 for unknown topics. The most recent events are always available via
 * {@link getEvents} without unbounded accumulation.
 */
class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private buffers = new Map<string, RingBuffer<unknown>>();
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private getBuffer(topic: string): RingBuffer<unknown> {
    let buf = this.buffers.get(topic);
    if (!buf) {
      const cap = (TOPIC_BUFFER_CAPS as Record<string, number>)[topic] ?? DEFAULT_BUFFER_CAP;
      buf = new RingBuffer<unknown>(cap);
      this.buffers.set(topic, buf);
    }
    return buf;
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
        this.getBuffer(topic).push(payload);
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

  subscribe(topic: string, handler: Handler): () => void {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler);
    this.connect();

    return () => {
      this.handlers.get(topic)?.delete(handler);
    };
  }

  /**
   * Returns a shallow copy of the most recent events buffered for `topic`,
   * oldest-first. Returns an empty array for topics with no events yet.
   */
  getEvents(topic: RealtimeTopic): unknown[] {
    return this.getBuffer(topic).toArray();
  }

  /** Returns the most recent event for `topic`, or `undefined`. */
  getLatest(topic: RealtimeTopic): unknown | undefined {
    return this.getBuffer(topic).latest();
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }
}

export const realtimeClient = new RealtimeClient();
export { REALTIME_TOPICS, type RealtimeTopic };

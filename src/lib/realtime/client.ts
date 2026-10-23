import { API_BASE_URL } from "@/lib/api/client";
import { TopicRegistry } from "./ringBuffer";
import { realtimeTracer } from "./telemetry";
import { frameRecorder } from "./recorder";
import { applyFrame, isRejection, isTopicFrame, type TopicState } from "./patch";
import { LastValueCache, normalizeTopic, type CachedValue } from "./lastValueCache";

type Handler = (payload: unknown) => void;

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private attempt = 0;
  private closedByUser = false;
  private topicState = new Map<string, TopicState>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private cache = new LastValueCache();

  /** Bounded per-topic ring-buffer registry (closes #253). */
  readonly registry = new TopicRegistry();

  connect(): void {
    if (typeof WebSocket === "undefined" || this.socket) return;
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    const wsUrl = API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1$/, "/ws");

    realtimeTracer.onConnectAttempt(wsUrl, this.attempt);
    frameRecorder.recordLifecycle("connect_attempt", { wsUrl, attempt: this.attempt });

    try {
      this.socket = new WebSocket(wsUrl);
    } catch (err) {
      realtimeTracer.onConnectError(wsUrl, err);
      frameRecorder.recordLifecycle("connect_error", { wsUrl, error: String(err) });
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener("open", () => {
      this.attempt = 0;
      realtimeTracer.onOpen(wsUrl);
      frameRecorder.recordLifecycle("open", { wsUrl });
    });

    this.socket.addEventListener("message", (event) => {
      try {
        const { topic, payload } = JSON.parse(event.data as string) as {
          topic: string;
          payload: unknown;
        };

        const frame = this.registry.record(topic, payload);
        if (frame) frameRecorder.recordFrame(frame);
        realtimeTracer.onMessage(topic);
        this.dispatch(topic, payload);
      } catch {
        // Malformed message — ignore, don't crash the connection.
      }
    });

    this.socket.addEventListener("close", () => {
      realtimeTracer.onClose(wsUrl);
      frameRecorder.recordLifecycle("close", { wsUrl });
      this.socket = null;
      this.topicState.clear();
      if (!this.closedByUser) this.scheduleReconnect();
    });

    this.socket.addEventListener("error", () => {
      realtimeTracer.onError(wsUrl);
      frameRecorder.recordLifecycle("socket_error", { wsUrl });
      this.socket?.close();
    });
  }

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
    realtimeTracer.onReconnectScheduled(delay, this.attempt);
    frameRecorder.recordLifecycle("reconnect_scheduled", { delayMs: delay, attempt: this.attempt });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.open();
    }, delay);
  }

  publish(topic: string, payload: unknown, source = "ws", sequence?: number): void {
    const key = normalizeTopic(topic);
    this.cache.set(key, payload, source, sequence);
    this.handlers.get(key)?.forEach((handler) => handler(payload));
  }

  getLastValue<T = unknown>(topic: string): CachedValue<T> | undefined {
    return this.cache.get<T>(topic);
  }

  clearCache(): void {
    this.cache.clear();
  }

  subscribe(topic: string, handler: Handler): () => void {
    const key = normalizeTopic(topic);
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler);
    realtimeTracer.onSubscribe(key, this.handlers.get(key)!.size);
    frameRecorder.recordLifecycle("subscribe", { topic: key });
    this.connect();

    return () => {
      this.handlers.get(key)?.delete(handler);
      const remaining = this.handlers.get(key)?.size ?? 0;
      realtimeTracer.onUnsubscribe(key, remaining);
      frameRecorder.recordLifecycle("unsubscribe", { topic: key });
    };
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    realtimeTracer.onDisconnect();
    frameRecorder.recordLifecycle("disconnect", {});
    this.socket?.close();
    this.socket = null;
    this.cache.clear();
  }

  notifyFallbackActivated(reason: string): void {
    realtimeTracer.onFallbackActivated(reason);
    frameRecorder.recordLifecycle("fallback_activated", { reason });
  }
}

export const realtimeClient = new RealtimeClient();

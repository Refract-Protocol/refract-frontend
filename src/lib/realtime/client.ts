import { API_BASE_URL } from "@/lib/api/client";
import { TopicRegistry } from "./ringBuffer";
import { realtimeTracer } from "./telemetry";
import { frameRecorder } from "./recorder";

type Handler = (payload: unknown) => void;

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

/**
 * A small reconnecting WebSocket wrapper exposing a subscribe-by-topic API.
 *
 * Backend contract (documented, not yet implemented upstream): connect to
 * `${wsUrl}`, receive JSON messages shaped `{ topic: string, payload:
 * unknown }`, one topic per push-based update type (e.g. "oracle_update").
 * Callers must treat this connection as best-effort — always keep an
 * independent REST fetch as the source of truth for initial state.
 *
 * Extension points wired into this class:
 *
 *   • `TopicRegistry` (ringBuffer.ts) — every received frame is recorded in
 *     a bounded per-topic ring buffer before being dispatched to handlers.
 *     This prevents unbounded memory growth under high-frequency streams
 *     (closes #253).
 *
 *   • `realtimeTracer` (telemetry.ts) — connection attempts, open, close,
 *     reconnects, message dispatch, and fallback activations emit OTel spans
 *     and counters so the team gains backend-correlatable visibility
 *     (closes #237).
 *
 *   • `frameRecorder` (recorder.ts) — when recording is active, every frame
 *     (including connection lifecycle events) is captured with timestamps so
 *     the stream can be replayed deterministically in tests (closes #236).
 */
class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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

        // 1. Record in bounded ring buffer (before dispatch, so the frame is
        //    available even if a handler throws).
        const frame = this.registry.record(topic, payload);

        // 2. Append to recorder session (no-op when recording is off).
        if (frame) frameRecorder.recordFrame(frame);

        // 3. Emit OTel span for this message dispatch.
        realtimeTracer.onMessage(topic);

        // 4. Dispatch to subscribers.
        this.handlers.get(topic)?.forEach((handler) => handler(payload));
      } catch {
        // Malformed message — ignore, don't crash the connection.
      }
    });

    this.socket.addEventListener("close", () => {
      realtimeTracer.onClose(wsUrl);
      frameRecorder.recordLifecycle("close", { wsUrl });
      this.socket = null;
      if (!this.closedByUser) this.scheduleReconnect();
    });

    this.socket.addEventListener("error", () => {
      realtimeTracer.onError(wsUrl);
      frameRecorder.recordLifecycle("socket_error", { wsUrl });
      this.socket?.close();
    });
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

  subscribe(topic: string, handler: Handler): () => void {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler);
    realtimeTracer.onSubscribe(topic, this.handlers.get(topic)!.size);
    frameRecorder.recordLifecycle("subscribe", { topic });
    this.connect();

    return () => {
      this.handlers.get(topic)?.delete(handler);
      const remaining = this.handlers.get(topic)?.size ?? 0;
      realtimeTracer.onUnsubscribe(topic, remaining);
      frameRecorder.recordLifecycle("unsubscribe", { topic });
    };
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    realtimeTracer.onDisconnect();
    frameRecorder.recordLifecycle("disconnect", {});
    this.socket?.close();
    this.socket = null;
  }

  /**
   * Signal that a REST fallback was activated (e.g. due to WS being
   * unavailable or `realtime-oracle` flag being off). Emits an OTel counter
   * increment so the team can see fallback rate relative to live connections.
   */
  notifyFallbackActivated(reason: string): void {
    realtimeTracer.onFallbackActivated(reason);
    frameRecorder.recordLifecycle("fallback_activated", { reason });
  }
}

export const realtimeClient = new RealtimeClient();

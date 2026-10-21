import { API_BASE_URL } from "@/lib/api/client";
import { startWakeDetector } from "./lifecycle";
import type { TopicMap } from "./topics";

type Handler = (payload: unknown) => void;

/** Lifecycle of the realtime connection, surfaced so the UI never silently shows stale data. */
export type RealtimeStatus = "idle" | "connecting" | "live" | "resyncing" | "offline";

/** A non-WebSocket source (e.g. Horizon SSE) that shares the client's lifecycle and health. */
export interface StreamTransport {
  start(): void;
  stop(): void;
}

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const SEEN_IDS_CAP = 500;

/**
 * A small reconnecting WebSocket wrapper exposing a subscribe-by-topic API.
 * The backend contract this assumes (documented, not yet implemented
 * upstream): connect to `${wsUrl}`, receive JSON messages shaped
 * `{ topic: string, payload: unknown }`, one topic per push-based update
 * type (e.g. "oracle_update"). On every (re)connect the client sends one
 * `{ type: "subscribe", topics, snapshot: true }` batch for all active topics.
 * Callers must treat this connection as best-effort — always keep an
 * independent REST fetch as the source of truth for initial state.
 */
class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private transports = new Set<StreamTransport>();
  private statusListeners = new Set<(s: RealtimeStatus) => void>();
  private status: RealtimeStatus = "idle";
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopWake: (() => void) | null = null;
  /** Bounded set of recent event ids so a post-resync snapshot replay is reconciled, not duplicated. */
  private seenIds = new Set<string>();

  getStatus(): RealtimeStatus {
    return this.status;
  }

  onStatus(listener: (s: RealtimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(next: RealtimeStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.statusListeners.forEach((l) => l(next));
  }

  connect(): void {
    if (typeof WebSocket === "undefined" || this.socket) return;
    this.closedByUser = false;
    this.stopWake ??= startWakeDetector(() => this.resync());
    this.open();
  }

  private open(): void {
    const wsUrl = API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1$/, "/ws");
    if (this.status !== "resyncing") this.setStatus("connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      this.setStatus("offline");
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.setStatus("live");
      const topics = [...this.handlers.keys()];
      if (topics.length > 0) socket.send(JSON.stringify({ type: "subscribe", topics, snapshot: true }));
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      try {
        const { topic, payload } = JSON.parse(event.data as string) as { topic: string; payload: unknown };
        if (this.isDuplicate(payload)) return;
        this.handlers.get(topic)?.forEach((handler) => handler(payload));
      } catch {
        // Malformed message — ignore, don't crash the connection.
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.closedByUser) return;
      this.setStatus("offline");
      this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      socket.close();
    });
  }

  private isDuplicate(payload: unknown): boolean {
    const id = (payload as { id?: unknown } | null)?.id;
    if (typeof id !== "string") return false;
    if (this.seenIds.has(id)) return true;
    this.seenIds.add(id);
    if (this.seenIds.size > SEEN_IDS_CAP) this.seenIds.delete(this.seenIds.values().next().value as string);
    return false;
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
   * Drops the (possibly dead) connection and reconnects once, immediately,
   * resubscribing every active topic as a single batch with a snapshot
   * request. Idempotent: it supersedes any pending backoff timer instead of
   * adding a second reconnect.
   */
  resync(): void {
    if (this.closedByUser || this.handlers.size === 0) return;
    this.setStatus("resyncing");
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const stale = this.socket;
    this.socket = null; // detaches stale listeners (they check identity)
    stale?.close();
    this.attempt = 0;
    this.transports.forEach((t) => {
      t.stop();
      t.start();
    });
    this.open();
  }

  registerTransport(transport: StreamTransport): () => void {
    this.transports.add(transport);
    return () => this.transports.delete(transport);
  }

  subscribe<T extends keyof TopicMap>(topic: T, handler: (payload: TopicMap[T]) => void): () => void;
  subscribe(topic: string, handler: Handler): () => void;
  subscribe(topic: string, handler: Handler): () => void {
    const isNew = !this.handlers.has(topic);
    if (isNew) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler);
    this.connect();
    if (isNew && this.socket?.readyState === 1) {
      this.socket.send(JSON.stringify({ type: "subscribe", topics: [topic], snapshot: true }));
    }

    return () => {
      this.handlers.get(topic)?.delete(handler);
    };
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopWake?.();
    this.stopWake = null;
    this.socket?.close();
    this.socket = null;
    this.setStatus("idle");
  }
}

export const realtimeClient = new RealtimeClient();

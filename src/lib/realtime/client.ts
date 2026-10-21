import { API_BASE_URL } from "../api/client";
import { DEFAULT_FLAGS } from "../flags/flagsConfig";
import { isRealtimeTopicEnabled, sanitizeFlags } from "./flags";
import {
  CLOSE_AUTH_FAILED,
  parseFrame,
  type ClientOp,
  type RealtimeTopic,
  type TopicMessageMap,
} from "./protocol";

/**
 * Typed, reconnecting realtime transport (contract: docs/realtime-protocol.md).
 *
 * - `subscribe(topic, handler, opts)` / `unsubscribe(handle)`; handlers receive the
 *   topic's typed message. One server subscription per topic, ref-counted.
 * - State machine: idle → connecting → open → reconnecting → closed, observable via
 *   `observeState`. The socket is opened lazily on the first enabled subscription and
 *   closed (back to idle) when the last one goes away, so nothing leaks.
 * - Reconnect uses capped exponential backoff with equal jitter; a heartbeat ping runs
 *   while open and a connection silent for `staleAfterMs` is force-reconnected.
 *   Reconnects resume each topic from its last seen `seq` (cursor replay).
 * - Inbound frames are validated; malformed/unknown topic/version frames are logged
 *   (reason only, never payloads) and dropped. Auth close (4401) is terminal.
 * - Gated by flags (`realtime-enabled` + per-topic): a disabled topic is never sent to
 *   the server; flipping it off via `setFlags` suspends it and fires `onDisabled` so
 *   callers fall back to REST. No React imports, so it can run in a SharedWorker.
 * - Out of scope here: hook wiring, authenticated subscriptions, multi-tab dedup.
 * - Always keep an independent REST fetch as the source of truth for initial state.
 */
export type ConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface SocketLike {
  send(data: string): void;
  close(code?: number): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface RealtimeClientOptions {
  url?: string;
  socketFactory?: (url: string) => SocketLike;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  heartbeatIntervalMs?: number;
  staleAfterMs?: number;
  /** Returns [0,1); injectable for deterministic tests. */
  random?: () => number;
  flags?: Record<string, boolean>;
  logger?: Pick<Console, "warn">;
}

export interface SubscribeOptions {
  /** Resume after this `seq` on first subscribe. */
  cursor?: number;
  /** Called when the topic's flag turns off while subscribed; fall back to REST here. */
  onDisabled?: () => void;
}

export interface SubscriptionHandle {
  readonly id: number;
  readonly topic: RealtimeTopic;
}

type Handler<T extends RealtimeTopic> = (message: TopicMessageMap[T]) => void;
interface Sub {
  id: number;
  topic: RealtimeTopic;
  handler: Handler<RealtimeTopic>;
  opts: SubscribeOptions;
}

/** Derives the WebSocket URL from the API base the same way the REST client does. */
export function deriveRealtimeUrl(apiBase: string = API_BASE_URL): string {
  return apiBase.replace(/^http/, "ws").replace(/\/api\/v1\/?$/, "/ws");
}

export class RealtimeClient {
  private opts: Required<Omit<RealtimeClientOptions, "url" | "socketFactory" | "flags">> &
    Pick<RealtimeClientOptions, "url" | "socketFactory">;
  private flags: Record<string, boolean>;
  private state: ConnectionState = "idle";
  private stateListeners = new Set<(s: ConnectionState) => void>();
  private subs = new Map<number, Sub>();
  private nextId = 1;
  private cursors = new Map<RealtimeTopic, number>();
  private wire = new Set<RealtimeTopic>(); // topics subscribed on the current socket
  private socket: SocketLike | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastSeenAt = 0;
  private offline = false;
  private envBound = false;

  constructor(options: RealtimeClientOptions = {}) {
    this.flags = { ...DEFAULT_FLAGS, ...sanitizeFlags(options.flags) };
    this.opts = {
      url: options.url,
      socketFactory: options.socketFactory,
      baseBackoffMs: options.baseBackoffMs ?? 1_000,
      maxBackoffMs: options.maxBackoffMs ?? 30_000,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 15_000,
      staleAfterMs: options.staleAfterMs ?? 45_000,
      random: options.random ?? Math.random,
      logger: options.logger ?? console,
    };
  }

  getState(): ConnectionState {
    return this.state;
  }

  /** Observable state stream: emits the current state immediately, then every change. */
  observeState(listener: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  subscribe<T extends RealtimeTopic>(
    topic: T,
    handler: Handler<T>,
    opts: SubscribeOptions = {}
  ): SubscriptionHandle {
    const id = this.nextId++;
    this.subs.set(id, { id, topic, handler: handler as Handler<RealtimeTopic>, opts });
    if (opts.cursor !== undefined && !this.cursors.has(topic)) this.cursors.set(topic, opts.cursor);
    this.sync();
    return { id, topic };
  }

  unsubscribe(handle: SubscriptionHandle): void {
    if (!this.subs.delete(handle.id)) return;
    this.sync();
  }

  /** Re-evaluates gating. Topics that turn off are suspended (and notified); ones that turn on resume. */
  setFlags(flags: unknown): void {
    const before = new Map(
      Array.from(this.subs.values()).map((s) => [s.id, this.enabled(s.topic)])
    );
    this.flags = { ...DEFAULT_FLAGS, ...sanitizeFlags(flags) };
    for (const s of Array.from(this.subs.values())) {
      if (before.get(s.id) && !this.enabled(s.topic)) {
        try {
          s.opts.onDisabled?.();
        } catch {
          this.opts.logger.warn("[realtime] onDisabled handler threw");
        }
      }
    }
    this.sync();
  }

  /** Permanently stops the client (terminal until `connect()`); drops the socket and all timers. */
  close(): void {
    this.teardownSocket();
    this.clearReconnect();
    this.unbindEnv();
    this.setState("closed");
  }

  /** Re-arms a closed client. */
  connect(): void {
    if (this.state === "closed") this.setState("idle");
    this.sync();
  }

  private enabled(topic: RealtimeTopic): boolean {
    return isRealtimeTopicEnabled(this.flags, topic);
  }

  private activeTopics(): Set<RealtimeTopic> {
    const topics = new Set<RealtimeTopic>();
    this.subs.forEach((s) => this.enabled(s.topic) && topics.add(s.topic));
    return topics;
  }

  /** Reconciles the socket and wire subscriptions with the current subscriptions + flags. */
  private sync(): void {
    if (this.state === "closed") return;
    const want = this.activeTopics();
    if (want.size === 0) {
      this.teardownSocket();
      this.clearReconnect();
      this.unbindEnv();
      this.cursors.clear();
      this.setState("idle");
      return;
    }
    if (this.state === "idle") {
      this.bindEnv();
      this.open();
      return;
    }
    if (this.state === "open") this.syncWire(want);
  }

  private syncWire(want: Set<RealtimeTopic>): void {
    this.wire.forEach((t) => {
      if (!want.has(t)) {
        this.send({ op: "unsubscribe", topic: t });
        this.wire.delete(t);
        this.cursors.delete(t);
      }
    });
    want.forEach((t) => {
      if (this.wire.has(t)) return;
      const cursor = this.cursors.get(t);
      this.send(
        cursor === undefined ? { op: "subscribe", topic: t } : { op: "subscribe", topic: t, cursor }
      );
      this.wire.add(t);
    });
  }

  private open(): void {
    if (this.socket || this.offline) {
      if (this.offline) this.setState("reconnecting");
      return;
    }
    const url = this.opts.url ?? deriveRealtimeUrl();
    this.setState(this.attempt === 0 ? "connecting" : "reconnecting");
    let sock: SocketLike;
    try {
      sock = this.opts.socketFactory
        ? this.opts.socketFactory(url)
        : (new WebSocket(url) as unknown as SocketLike);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = sock;
    sock.onopen = () => {
      if (this.socket !== sock) return;
      this.attempt = 0;
      this.lastSeenAt = Date.now();
      this.setState("open");
      this.startHeartbeat();
      this.syncWire(this.activeTopics());
    };
    sock.onmessage = (ev) => {
      if (this.socket !== sock) return;
      this.lastSeenAt = Date.now();
      this.onFrame(ev.data);
    };
    sock.onerror = () => {
      /* close follows; handled there */
    };
    sock.onclose = (ev) => {
      if (this.socket !== sock) return; // already replaced/torn down: guards double-close
      this.socket = null;
      this.stopHeartbeat();
      this.wire.clear();
      if (ev?.code === CLOSE_AUTH_FAILED) {
        this.opts.logger.warn("[realtime] auth rejected; not reconnecting");
        this.setState("closed");
        return;
      }
      this.scheduleReconnect();
    };
  }

  private onFrame(raw: unknown): void {
    const res = parseFrame(raw);
    if (res.kind === "pong") return;
    if (res.kind === "ignored") {
      this.opts.logger.warn(`[realtime] ignored frame: ${res.reason}`);
      return;
    }
    const { message } = res;
    const prev = this.cursors.get(message.topic);
    if (prev === undefined || message.seq > prev) this.cursors.set(message.topic, message.seq);
    this.subs.forEach((s) => {
      if (s.topic !== message.topic || !this.enabled(s.topic)) return;
      try {
        s.handler(message);
      } catch {
        this.opts.logger.warn(`[realtime] handler for ${s.topic} threw`);
      }
    });
  }

  private send(op: ClientOp): void {
    try {
      this.socket?.send(JSON.stringify(op));
    } catch {
      /* socket closing; reconnect path will resubscribe */
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.state === "closed" || this.activeTopics().size === 0) return;
    this.setState("reconnecting");
    if (this.offline) return;
    const ceiling = Math.min(this.opts.maxBackoffMs, this.opts.baseBackoffMs * 2 ** this.attempt);
    const delay = Math.min(
      this.opts.maxBackoffMs,
      ceiling / 2 + (this.opts.random() * ceiling) / 2
    );
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private reconnectNow(): void {
    if (this.state !== "reconnecting" && this.state !== "open") return;
    this.clearReconnect();
    this.attempt = 0;
    this.teardownSocket();
    this.open();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.opts.heartbeatIntervalMs);
  }

  private heartbeat(): void {
    if (Date.now() - this.lastSeenAt > this.opts.staleAfterMs) {
      this.opts.logger.warn("[realtime] connection stale; reconnecting");
      const sock = this.socket;
      this.socket = null;
      this.stopHeartbeat();
      this.wire.clear();
      this.detach(sock);
      this.scheduleReconnect();
      return;
    }
    this.send({ op: "ping" });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private detach(sock: SocketLike | null): void {
    if (!sock) return;
    sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null;
    try {
      sock.close(1000);
    } catch {
      /* already closed */
    }
  }

  private teardownSocket(): void {
    const sock = this.socket;
    this.socket = null;
    this.stopHeartbeat();
    this.wire.clear();
    this.detach(sock);
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.stateListeners.forEach((l) => l(next));
  }

  private onOnline = () => {
    this.offline = false;
    if (this.state === "reconnecting") this.reconnectNow();
  };
  private onOffline = () => {
    this.offline = true;
    this.clearReconnect();
    if (this.state === "open" || this.state === "connecting") {
      this.teardownSocket();
      this.setState("reconnecting");
    }
  };
  private onVisibility = () => {
    if (typeof document === "undefined" || document.visibilityState !== "visible") return;
    if (this.state === "reconnecting" && !this.offline) this.reconnectNow();
    else if (this.state === "open") this.heartbeat();
  };

  private bindEnv(): void {
    if (this.envBound || typeof window === "undefined") return;
    this.envBound = true;
    this.offline = typeof navigator !== "undefined" && navigator.onLine === false;
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private unbindEnv(): void {
    if (!this.envBound) return;
    this.envBound = false;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }
}

/** Shared instance. Flags default off, so nothing connects until `setFlags` enables a topic. */
export const realtimeClient = new RealtimeClient();

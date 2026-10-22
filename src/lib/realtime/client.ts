import { API_BASE_URL } from "@/lib/api/client";
import { ACTIVE_NETWORK } from "@/lib/network";
import {
  supportedVersions,
  topicScope,
  type RealtimeScope,
  type TopicName,
  type TopicPayloads,
} from "./contract";
import { decodeFrame } from "./decode";
import { RealtimeConnectionError, RealtimeError, UnsupportedVersionError } from "./errors";
import { RealtimeHealthStore } from "./health";
import {
  createDefaultReporter,
  noopReporter,
  type RealtimeBreadcrumb,
  type RealtimeErrorContext,
  type RealtimeReporter,
} from "./reporter";

/**
 * Reconnecting WebSocket client exposing subscribe-by-topic.
 *
 * Realtime is best-effort: callers always keep a REST fetch as the source of
 * truth, and the adaptive polling scheduler reads `health` to decide how often
 * that REST fetch runs.
 *
 * Scope (network + account): every subscription is made under the current
 * scope, and each scope gets a new epoch. Changing scope tears the socket down,
 * clears per-identity buffers and re-subscribes under the new scope; frames
 * from an older epoch — including ones already queued when the switch
 * happened — are dropped, so data for one wallet/network can never be applied
 * to another.
 */

export interface FrameMeta {
  version: number;
  /** Scope epoch the frame was received under. */
  epoch: number;
  scope: RealtimeScope;
}

export type TopicHandler<T extends TopicName> = (
  payload: TopicPayloads[T],
  meta: FrameMeta
) => void;
type AnyHandler = (payload: unknown, meta: FrameMeta) => void;

export type ScopeListener = (scope: RealtimeScope, epoch: number) => void;

/** The part of the browser WebSocket API the client uses (lets tests inject a fake). */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open" | "close" | "error" | "message",
    listener: (event: any) => void
  ): void;
}

export interface RealtimeClientOptions {
  url?: () => string;
  /** Socket factory; defaults to the browser WebSocket. `null` disables connecting (SSR, tests). */
  createSocket?: ((url: string) => WebSocketLike) | null;
  reporter?: RealtimeReporter;
  health?: RealtimeHealthStore;
  /** Debounce for scope changes so rapid toggling doesn't open parallel connections. */
  scopeDebounceMs?: number;
  /** Failed attempts after which health goes from degraded to unavailable. */
  degradedAttempts?: number;
  /** Failed attempts after which "retries exhausted" is reported (reconnects continue at max backoff). */
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

const OPEN = 1;

export function scopeKey(scope: RealtimeScope): string {
  return `${scope.network}:${scope.account ?? "-"}`;
}

function defaultUrl(): string {
  return API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1$/, "/ws");
}

function defaultSocketFactory(): ((url: string) => WebSocketLike) | null {
  if (typeof WebSocket === "undefined") return null;
  return (url) => new WebSocket(url);
}

export class RealtimeClient {
  readonly health: RealtimeHealthStore;

  private readonly url: () => string;
  private readonly createSocket: ((url: string) => WebSocketLike) | null;
  private readonly reporter: RealtimeReporter;
  private readonly scopeDebounceMs: number;
  private readonly degradedAttempts: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;

  private enabled = false;
  private socket: WebSocketLike | null = null;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retriesExhaustedReported = false;

  private scope: RealtimeScope = { network: ACTIVE_NETWORK.id, account: null };
  private epoch = 0;
  private pendingScope: RealtimeScope | null = null;
  private scopeTimer: ReturnType<typeof setTimeout> | null = null;

  private handlers = new Map<TopicName, Set<AnyHandler>>();
  /** Last frame per topic for late subscribers. Per-identity: cleared on every scope change. */
  private lastFrames = new Map<TopicName, { payload: unknown; meta: FrameMeta }>();
  private scopeListeners = new Set<ScopeListener>();

  constructor(opts: RealtimeClientOptions = {}) {
    this.url = opts.url ?? defaultUrl;
    this.createSocket =
      opts.createSocket === undefined ? defaultSocketFactory() : opts.createSocket;
    this.reporter = opts.reporter ?? noopReporter;
    this.health = opts.health ?? new RealtimeHealthStore();
    this.scopeDebounceMs = opts.scopeDebounceMs ?? 250;
    this.degradedAttempts = opts.degradedAttempts ?? 2;
    this.maxAttempts = opts.maxAttempts ?? 6;
    this.baseBackoffMs = opts.baseBackoffMs ?? 1_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Turns realtime on/off (feature flag). While off, health is "unavailable" and REST polls at full cadence. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) {
      if (this.handlers.size > 0) this.open();
    } else {
      this.teardown("disabled");
      this.health.setConnection("unavailable");
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getScope(): RealtimeScope {
    return this.scope;
  }

  getEpoch(): number {
    return this.epoch;
  }

  /** True when a scope change is pending; frames are not delivered in the meantime. */
  isScopeChanging(): boolean {
    return this.pendingScope !== null;
  }

  subscribe<T extends TopicName>(topic: T, handler: TopicHandler<T>): () => void {
    const h = handler as AnyHandler;
    let set = this.handlers.get(topic);
    const isFirst = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
    }
    set.add(h);

    if (isFirst) this.sendSubscribe(topic);
    if (this.enabled && !this.socket && !this.reconnectTimer) this.open();

    // Replay the last frame of the *current* scope so late mounts render immediately.
    const last = this.lastFrames.get(topic);
    if (last && last.meta.epoch === this.epoch && !this.pendingScope) h(last.payload, last.meta);

    return () => {
      const current = this.handlers.get(topic);
      if (!current) return;
      current.delete(h);
      if (current.size === 0) {
        this.handlers.delete(topic);
        this.send({ type: "unsubscribe", topic });
      }
    };
  }

  /**
   * Moves realtime to a new network/account. Delivery stops immediately (so
   * nothing from the old identity reaches the new one); the reconnect is
   * debounced so toggling quickly doesn't open parallel connections.
   */
  setScope(next: RealtimeScope): void {
    const target = this.pendingScope ?? this.scope;
    if (scopeKey(next) === scopeKey(target)) return;

    if (scopeKey(next) === scopeKey(this.scope)) {
      // Toggled back to the current scope before the change applied.
      this.pendingScope = null;
      if (this.scopeTimer) clearTimeout(this.scopeTimer);
      this.scopeTimer = null;
      return;
    }

    this.pendingScope = next;
    if (this.scopeTimer) clearTimeout(this.scopeTimer);
    this.scopeTimer = setTimeout(() => {
      this.scopeTimer = null;
      const pending = this.pendingScope;
      this.pendingScope = null;
      if (pending) this.applyScope(pending);
    }, this.scopeDebounceMs);
  }

  /** Called synchronously after a scope change applies, so consumers can drop per-identity caches. */
  onScopeChange(listener: ScopeListener): () => void {
    this.scopeListeners.add(listener);
    return () => {
      this.scopeListeners.delete(listener);
    };
  }

  disconnect(): void {
    this.setEnabled(false);
  }

  // ── Scope ──────────────────────────────────────────────────────────────────

  private applyScope(next: RealtimeScope): void {
    const previous = this.scope;
    this.epoch += 1;
    this.scope = next;
    this.lastFrames.clear();
    this.health.resetTopics();
    this.breadcrumb({
      event: "scope_changed",
      level: "info",
      data: {
        epoch: this.epoch,
        network: next.network,
        networkChanged: previous.network !== next.network,
        accountChanged: previous.account !== next.account,
        hasAccount: next.account !== null,
      },
    });

    // Fresh connection per scope: no frame from the old socket can be applied.
    this.teardown("scope_change");
    this.attempt = 0;
    this.retriesExhaustedReported = false;
    this.scopeListeners.forEach((listener) => listener(next, this.epoch));
    if (this.enabled && this.handlers.size > 0) this.open();
  }

  // ── Connection lifecycle ───────────────────────────────────────────────────

  private open(): void {
    if (!this.enabled || !this.createSocket || this.socket) return;

    const epoch = this.epoch;
    this.breadcrumb({ event: "connecting", level: "info", data: { attempt: this.attempt, epoch } });

    let socket: WebSocketLike;
    try {
      socket = this.createSocket(this.url());
    } catch (cause) {
      this.reportConnectionFailure(cause);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    const isCurrent = () => this.socket === socket && this.epoch === epoch;

    socket.addEventListener("open", () => {
      if (!isCurrent()) return;
      this.attempt = 0;
      this.retriesExhaustedReported = false;
      this.health.setConnection("healthy");
      this.breadcrumb({ event: "open", level: "info", data: { epoch } });
      this.handlers.forEach((_, topic) => this.sendSubscribe(topic));
    });

    socket.addEventListener("message", (event: { data: unknown }) => {
      // Drop anything from a superseded socket/epoch, or while a scope change is pending.
      if (!isCurrent() || this.pendingScope) return;
      this.handleMessage(event.data, epoch);
    });

    socket.addEventListener("close", (event: { code?: number; wasClean?: boolean }) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.breadcrumb({
        event: "closed",
        level: event?.wasClean ? "info" : "warning",
        data: { code: event?.code ?? null, epoch },
      });
      if (this.enabled) this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (this.socket === socket) socket.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.enabled) return;
    this.attempt += 1;
    this.health.setConnection(this.attempt <= this.degradedAttempts ? "degraded" : "unavailable");

    if (this.attempt >= this.maxAttempts && !this.retriesExhaustedReported) {
      this.retriesExhaustedReported = true;
      this.breadcrumb({
        event: "fallback_engaged",
        level: "warning",
        data: { reason: "retries_exhausted", attempt: this.attempt },
      });
      this.capture(
        new RealtimeConnectionError(
          `Realtime connection failed ${this.attempt} times; falling back to REST`,
          "retries_exhausted"
        )
      );
    }

    const delay = Math.min(this.baseBackoffMs * 2 ** (this.attempt - 1), this.maxBackoffMs);
    this.breadcrumb({
      event: "reconnect_scheduled",
      level: "warning",
      data: { attempt: this.attempt, delayMs: delay },
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private teardown(reason: string): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    if (!socket) return;
    // Detach first so the close handler treats this socket as stale.
    this.socket = null;
    try {
      socket.close(1000, reason);
    } catch {
      // Already closed.
    }
  }

  // ── Frames ─────────────────────────────────────────────────────────────────

  private handleMessage(raw: unknown, epoch: number): void {
    let frame;
    try {
      frame = decodeFrame(raw);
    } catch (err) {
      if (err instanceof UnsupportedVersionError && err.topic) {
        this.engageTopicFallback(err.topic as TopicName, err);
      } else if (err instanceof RealtimeError) {
        this.capture(err, err.topic);
      }
      return;
    }

    if (frame.kind === "unsupported_version") {
      this.engageTopicFallback(
        frame.topic as TopicName,
        new UnsupportedVersionError(frame.topic, null)
      );
      return;
    }
    if (frame.kind === "subscribed") return;

    const { topic } = frame;
    if (this.health.isRestOnly(topic)) return;

    // Belt and braces: if the server labels the frame's scope, it must match ours.
    if (frame.scope) {
      if (frame.scope.network !== undefined && frame.scope.network !== this.scope.network) return;
      if (
        topicScope(topic) === "account" &&
        frame.scope.account !== undefined &&
        frame.scope.account !== this.scope.account
      ) {
        return;
      }
    }

    const meta: FrameMeta = { version: frame.version, epoch, scope: this.scope };
    this.lastFrames.set(topic, { payload: frame.payload, meta });
    this.handlers.get(topic)?.forEach((handler) => {
      try {
        handler(frame.payload, meta);
      } catch {
        // A consumer bug must not take the connection down.
      }
    });
  }

  private engageTopicFallback(topic: TopicName, error: UnsupportedVersionError): void {
    if (this.health.isRestOnly(topic)) return;
    this.health.markRestOnly(topic);
    this.send({ type: "unsubscribe", topic });
    this.breadcrumb({
      event: "fallback_engaged",
      level: "warning",
      data: { topic, reason: "unsupported_version" },
    });
    this.capture(error, topic);
  }

  // ── Outbound ───────────────────────────────────────────────────────────────

  private sendSubscribe(topic: TopicName): void {
    if (this.health.isRestOnly(topic)) return;
    const accountScoped = topicScope(topic) === "account";
    if (accountScoped && !this.scope.account) return;
    this.send({
      type: "subscribe",
      topic,
      versions: supportedVersions(topic),
      scope: accountScoped ? this.scope : { network: this.scope.network },
    });
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket && this.socket.readyState === OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  // ── Reporting ──────────────────────────────────────────────────────────────

  private context(topic?: string): RealtimeErrorContext {
    const fallback =
      topic && this.health.isRestOnly(topic)
        ? "topic"
        : this.health.get() === "unavailable"
          ? "all"
          : "none";
    return { topic, transport: "websocket", attempt: this.attempt, fallback };
  }

  private capture(error: RealtimeError, topic?: string): void {
    this.reporter.captureError(error, this.context(topic ?? error.topic));
  }

  private reportConnectionFailure(cause: unknown): void {
    this.capture(
      new RealtimeConnectionError("Failed to open realtime socket", "connection", { cause })
    );
  }

  private breadcrumb(crumb: RealtimeBreadcrumb): void {
    this.reporter.addBreadcrumb(crumb);
  }
}

export const realtimeClient = new RealtimeClient({ reporter: createDefaultReporter() });

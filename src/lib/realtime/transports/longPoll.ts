import { encodeCursors, type ClientMessage, type Cursors } from "../topics";
import type {
  ConnectContext,
  RealtimeTransport,
  TransportCallbacks,
  TransportCloseInfo,
} from "./types";

/**
 * Long-poll contract (backend implements; documented in docs/realtime.md):
 *
 *   GET {url}?topics=a,b&after=a:41,b:7
 *     200 { events: Frame[], gap?: string[], timeoutMs?: number }
 *     204 (no events before the server's hold timeout)
 *     401/403 auth rejected · 404 endpoint not offered · 429/5xx retry later
 *
 * The server holds the request open until it has events or its hold timeout
 * (`timeoutMs`, advertised in each 200 response) elapses. A request naming a
 * topic with no cursor is answered immediately with `cursors` (the topic's
 * current seq), which acts as the handshake and the subscribe acknowledgement.
 */
export interface LongPollResponseBody {
  events?: unknown[];
  gap?: string[];
  timeoutMs?: number;
  /** Current position for topics requested without a cursor (handshake). */
  cursors?: Cursors;
}

export interface VisibilitySource {
  isHidden(): boolean;
  /** Returns an unsubscribe function. */
  onChange(listener: () => void): () => void;
}

export interface LongPollTransportOptions {
  url: string;
  fetchImpl?: typeof fetch;
  /** Hold timeout assumed until the server advertises one. */
  defaultTimeoutMs?: number;
  /** Extra time allowed past the server hold timeout before the client aborts. */
  timeoutGraceMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Consecutive failures tolerated before reporting the transport closed. */
  maxConsecutiveFailures?: number;
  /** Hard cap on in-flight requests for this connection. */
  maxConcurrentRequests?: number;
  visibility?: VisibilitySource | null;
}

export interface LongPollStats {
  requests: number;
  timeouts: number;
  failures: number;
  inFlight: number;
}

function documentVisibility(): VisibilitySource | null {
  if (typeof document === "undefined") return null;
  return {
    isHidden: () => document.visibilityState === "hidden",
    onChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

/**
 * Cursor-based long-poll transport: the last-resort push path for clients
 * that support neither WebSocket nor EventSource.
 *
 * One request at a time (capped by `maxConcurrentRequests`), each with its
 * own AbortController. Requests go through the same base URL as REST calls
 * with `credentials: "include"`, so whatever auth the API/proxy applies to
 * REST applies here too.
 */
export class LongPollTransport implements RealtimeTransport {
  readonly kind = "long-poll" as const;
  readonly stats: LongPollStats = { requests: 0, timeouts: 0, failures: 0, inFlight: 0 };

  private callbacks: TransportCallbacks | null = null;
  private ctx: ConnectContext | null = null;
  private topics = new Set<string>();
  private controllers = new Set<AbortController>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeVisibility: (() => void) | null = null;
  private opened = false;
  private ackPending = true;
  private consecutiveFailures = 0;
  private serverTimeoutMs: number;
  /** Positions advertised by the server, for topics that have had no events yet. */
  private serverCursors: Cursors = {};
  private readonly o: Required<Omit<LongPollTransportOptions, "visibility" | "fetchImpl">> & {
    fetchImpl: typeof fetch;
    visibility: VisibilitySource | null;
  };

  constructor(options: LongPollTransportOptions) {
    this.o = {
      url: options.url,
      fetchImpl: options.fetchImpl ?? ((...args) => fetch(...args)),
      defaultTimeoutMs: options.defaultTimeoutMs ?? 25_000,
      timeoutGraceMs: options.timeoutGraceMs ?? 5_000,
      backoffBaseMs: options.backoffBaseMs ?? 1_000,
      backoffMaxMs: options.backoffMaxMs ?? 30_000,
      maxConsecutiveFailures: options.maxConsecutiveFailures ?? 5,
      maxConcurrentRequests: options.maxConcurrentRequests ?? 1,
      visibility: options.visibility === undefined ? documentVisibility() : options.visibility,
    };
    this.serverTimeoutMs = this.o.defaultTimeoutMs;
  }

  connect(ctx: ConnectContext, callbacks: TransportCallbacks): void {
    this.ctx = ctx;
    this.callbacks = callbacks;
    this.topics = new Set(ctx.topics);
    this.opened = false;
    this.ackPending = true;
    this.consecutiveFailures = 0;
    this.unsubscribeVisibility = this.o.visibility?.onChange(() => this.handleVisibility()) ?? null;
    this.poll();
  }

  disconnect(): void {
    this.callbacks = null;
    this.teardown();
  }

  send(_message: ClientMessage): void {
    // Requests are GETs derived from the topic set; there is no upstream channel.
  }

  subscribe(topics: string[], _cursors: Cursors): void {
    const before = this.topics.size;
    topics.forEach((t) => this.topics.add(t));
    if (this.topics.size !== before) this.restart();
  }

  unsubscribe(topics: string[]): void {
    const before = this.topics.size;
    topics.forEach((t) => this.topics.delete(t));
    if (this.topics.size !== before) this.restart();
  }

  /** Abort the in-flight request and poll again immediately with the new topic set. */
  private restart(): void {
    if (!this.callbacks) return;
    this.ackPending = true;
    this.abortAll();
    this.clearRetry();
    this.poll();
  }

  private handleVisibility(): void {
    if (!this.callbacks) return;
    if (this.o.visibility?.isHidden()) {
      // Free the connection while hidden; browsers throttle background timers
      // anyway, and this prevents requests piling up when the tab wakes.
      this.abortAll();
      this.clearRetry();
    } else if (this.controllers.size === 0 && !this.retryTimer) {
      this.poll();
    }
  }

  private poll(): void {
    if (!this.callbacks || this.topics.size === 0) return;
    if (this.o.visibility?.isHidden()) return;
    if (this.controllers.size >= this.o.maxConcurrentRequests) return;
    void this.request();
  }

  private async request(): Promise<void> {
    const controller = new AbortController();
    this.controllers.add(controller);
    this.stats.inFlight = this.controllers.size;
    this.stats.requests += 1;

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.serverTimeoutMs + this.o.timeoutGraceMs);

    const requestedTopics = [...this.topics];
    const params = new URLSearchParams({ topics: requestedTopics.join(",") });
    const cursors = encodeCursors(this.requestCursors(requestedTopics));
    if (cursors) params.set("after", cursors);

    try {
      const res = await this.o.fetchImpl(`${this.o.url}?${params}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (controller.signal.aborted && !timedOut) return;
      await this.handleResponse(res, requestedTopics, controller);
    } catch (err) {
      if (!this.controllers.has(controller)) return; // aborted by us: restart/hidden/disconnect
      if (timedOut) {
        // Held past the advertised timeout: treat as an empty poll, go again.
        this.stats.timeouts += 1;
        this.markHealthy(requestedTopics, undefined);
        this.afterRequest(controller, 0);
        return;
      }
      this.handleFailure(controller, err);
      return;
    } finally {
      clearTimeout(timeout);
    }
    this.afterRequest(controller, 0);
  }

  private async handleResponse(
    res: Response,
    requestedTopics: string[],
    controller: AbortController
  ): Promise<void> {
    if (res.status === 401 || res.status === 403) {
      throw new TerminalError({
        code: 4400 + (res.status - 400),
        reason: `HTTP ${res.status}`,
        auth: true,
      });
    }
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      throw new TerminalError({ code: 1002, reason: `HTTP ${res.status}`, unsupported: true });
    }
    if (res.status === 429 || res.status >= 500) {
      throw new RetryableError(res.status, parseRetryAfter(res.headers.get("Retry-After")));
    }
    if (res.status === 204) {
      if (this.controllers.has(controller)) this.markHealthy(requestedTopics, undefined);
      return;
    }
    if (!res.ok) {
      throw new RetryableError(res.status, null);
    }

    const body = (await res.json()) as LongPollResponseBody;
    if (typeof body.timeoutMs === "number" && body.timeoutMs > 0) {
      this.serverTimeoutMs = body.timeoutMs;
    }
    for (const [topic, seq] of Object.entries(body.cursors ?? {})) {
      if (Number.isInteger(seq))
        this.serverCursors[topic] = Math.max(seq, this.serverCursors[topic] ?? 0);
    }
    // A request superseded by a topic change still delivers its events, but
    // must not acknowledge the new topic set on its behalf.
    if (this.controllers.has(controller)) this.markHealthy(requestedTopics, body.gap);
    for (const event of body.events ?? []) {
      if (!this.callbacks) return;
      this.callbacks.onFrame(event);
    }
  }

  /** The client's applied cursors, falling back to server-advertised positions. */
  private requestCursors(topics: string[]): Cursors {
    const client = this.ctx?.getCursors() ?? {};
    const out: Cursors = {};
    for (const topic of topics) {
      const seq = Math.max(client[topic] ?? -1, this.serverCursors[topic] ?? -1);
      if (seq >= 0) out[topic] = seq;
    }
    return out;
  }

  /** First good response opens the transport and acknowledges the topic set. */
  private markHealthy(requestedTopics: string[], gap: string[] | undefined): void {
    this.consecutiveFailures = 0;
    if (!this.callbacks) return;
    if (!this.opened) {
      this.opened = true;
      this.callbacks.onOpen();
    }
    if (this.ackPending || (gap && gap.length > 0)) {
      this.ackPending = false;
      this.callbacks?.onFrame({ type: "subscribed", topics: requestedTopics, gap });
    }
  }

  private afterRequest(controller: AbortController, delayMs: number): void {
    this.controllers.delete(controller);
    this.stats.inFlight = this.controllers.size;
    if (!this.callbacks) return;
    if (delayMs > 0) this.scheduleRetry(delayMs);
    else this.poll();
  }

  private handleFailure(controller: AbortController, err: unknown): void {
    this.controllers.delete(controller);
    this.stats.inFlight = this.controllers.size;
    this.stats.failures += 1;
    if (!this.callbacks) return;

    if (err instanceof TerminalError) {
      this.close(err.info);
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.o.maxConsecutiveFailures) {
      this.close({ code: 1006, reason: describe(err) });
      return;
    }
    const backoff = Math.min(
      this.o.backoffBaseMs * 2 ** (this.consecutiveFailures - 1),
      this.o.backoffMaxMs
    );
    const retryAfter = err instanceof RetryableError ? err.retryAfterMs : null;
    this.scheduleRetry(Math.max(backoff, retryAfter ?? 0));
  }

  private scheduleRetry(delayMs: number): void {
    this.clearRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.poll();
    }, delayMs);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private close(info: TransportCloseInfo): void {
    const callbacks = this.callbacks;
    this.callbacks = null;
    this.teardown();
    callbacks?.onClose(info);
  }

  private abortAll(): void {
    const controllers = [...this.controllers];
    this.controllers.clear();
    this.stats.inFlight = 0;
    controllers.forEach((c) => c.abort());
  }

  private teardown(): void {
    this.abortAll();
    this.clearRetry();
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = null;
  }
}

class TerminalError extends Error {
  constructor(readonly info: TransportCloseInfo) {
    super(info.reason);
  }
}

class RetryableError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null
  ) {
    super(`HTTP ${status}`);
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

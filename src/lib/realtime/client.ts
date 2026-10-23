import { API_BASE_URL } from "@/lib/api/client";
import { getRealtimeCapability } from "@/lib/realtime/capabilities";

type Handler = (payload: unknown) => void;

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const CURSOR_STORAGE_PREFIX = "realtime:cursor:";
const MAX_REPORTED_RECONNECT_LOOPS = 5;

/**
 * Machine-readable connection status the UI can branch on.
 * - `idle`: never connected / explicitly disconnected
 * - `connecting`: initial connection in flight
 * - `open`: connected and healthy
 * - `reconnecting`: dropped, waiting to retry
 * - `closed`: closed by the user
 */
export type RealtimeStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface RealtimeHealth {
  status: RealtimeStatus;
  /** Transport currently in use, e.g. "websocket". */
  transport: string;
  /** Number of reconnect attempts since the last successful open. */
  attempt: number;
  /** Epoch ms of the last message received, or null if none yet. */
  lastMessageAt: number | null;
  /** Age in ms of the last message, or null if none yet. */
  lastMessageAgeMs: number | null;
  /** Last error surfaced by the transport, redacted for reporting. */
  lastError: string | null;
  /** Cumulative count of transport errors observed. */
  errorCount: number;
}

type HealthListener = (health: RealtimeHealth) => void;

/**
 * A single observed realtime message, captured for the dev inspector.
 * `direction` is `in` for messages received from the server and `out` for
 * subscribe frames sent by the client.
 */
export interface RealtimeInspectorEvent {
  id: number;
  topic: string;
  seq: number | null;
  direction: "in" | "out";
  timestamp: number;
  payload: unknown;
}

type InspectorListener = (events: RealtimeInspectorEvent[]) => void;

/**
 * Strips tokens/URLs from error strings before they leave the client so
 * health signals can be safely forwarded to error monitoring.
 */
function redactError(message: string): string {
  return message
    .replace(/wss?:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted-url]")
    .replace(/(token|access_token|auth|key|secret)=[^&\s"']+/gi, "$1=[redacted]");
}

/**
 * Realtime WebSocket client.
 *
 * Handles connection lifecycle, subscription replay, and auth token expiry
 * for wallet-scoped subscriptions. Token acquisition is isolated behind an
 * injected AuthTokenProvider so the transport stays wallet-agnostic.
 *
 * A small reconnecting WebSocket wrapper exposing a subscribe-by-topic API.
 * The backend contract this assumes (documented, not yet implemented
 * upstream): connect to `${wsUrl}`, receive JSON messages shaped
 * `{ topic: string, payload: unknown, seq?: number }`, one topic per
 * push-based update type (e.g. "oracle_update"). Callers must treat this
 * connection as best-effort — always keep an independent REST fetch as the
 * source of truth for initial state.
 *
 * Snapshot-and-resume: the last-applied sequence per topic is persisted and
 * sent as a `since` cursor on (re)subscribe so the server can replay missed
 * events. On reconnect the client first refetches the REST snapshot for the
 * topic, then replays any events newer than the stored cursor through the
 * idempotent merge layer. If replay is unavailable or the cursor is too old,
 * it falls back to a fresh snapshot with no streamed delta.
 *
 * Health: the client maintains an observable health snapshot emitted to
 * subscribers on state transitions (not per-message) so React can subscribe
 * rather than poll. High-frequency message timestamps are coalesced.
 *
 * Inspector: a dev-only tap point exposes a bounded ring buffer of recent
 * messages (raw in/out frames) to the dev inspector panel. It is a passive
 * observer — subscribing to it never triggers a (re)subscribe on the socket.
 *
 * Transport is negotiated at startup via `getRealtimeCapability()`. Until
 * capability is confirmed the client stays on REST; it only opens a socket
 * when the backend advertises WebSocket support, avoiding reconnect loops
 * against backends that never answer.
 */

import type {
  AuthTokenProvider,
  AuthenticatedSubscription,
  RealtimeAuthOptions,
  RealtimeCloseCode,
  RealtimeConnectionState,
  RealtimeDegradedState,
} from './types';

const AUTH_CLOSE_CODES: ReadonlySet<number> = new Set([4001, 4003, 4401, 4403]);
const DEFAULT_MAX_REFRESH_ATTEMPTS = 2;

export interface RealtimeClientOptions extends RealtimeAuthOptions {
  url: string;
  onStateChange?: (state: RealtimeConnectionState) => void;
  onDegraded?: (state: RealtimeDegradedState) => void;
}
 */

import type {
  AuthTokenProvider,
  AuthenticatedSubscription,
  RealtimeAuthOptions,
  RealtimeCloseCode,
  RealtimeConnectionState,
  RealtimeDegradedState,
} from './types';

const AUTH_CLOSE_CODES: ReadonlySet<number> = new Set([4001, 4003, 4401, 4403]);
const DEFAULT_MAX_REFRESH_ATTEMPTS = 2;

export interface RealtimeClientOptions extends RealtimeAuthOptions {
  url: string;
  onStateChange?: (state: RealtimeConnectionState) => void;
  onDegraded?: (state: RealtimeDegradedState) => void;
}

export class RealtimeClient {
  private readonly url: string;
  private readonly auth?: AuthTokenProvider;
  private readonly maxRefreshAttempts: number;
  private readonly onStateChange?: (state: RealtimeConnectionState) => void;
  private readonly onDegraded?: (state: RealtimeDegradedState) => void;

  private socket: WebSocket | null = null;
  private state: RealtimeConnectionState = 'idle';
  private refreshAttempts = 0;
  private refreshInFlight: Promise<string | null> | null = null;
  private readonly authenticatedSubscriptions = new Map<string, AuthenticatedSubscription>();
  private handlers = new Map<string, Set<Handler>>();
  private cursors = new Map<string, number>();
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private negotiated = false;

  constructor(options: RealtimeClientOptions) {
    this.url = options.url;
    this.auth = options.auth;
    this.maxRefreshAttempts = options.maxRefreshAttempts ?? DEFAULT_MAX_REFRESH_ATTEMPTS;
    this.onStateChange = options.onStateChange;
    this.onDegraded = options.onDegraded;
  }

  private health: RealtimeHealth = {
    status: "idle",
    transport: "websocket",
    attempt: 0,
    lastMessageAt: null,
    lastMessageAgeMs: null,
    lastError: null,
    errorCount: 0,
  };
  private healthListeners = new Set<HealthListener>();
  private messageCoalesceTimer: ReturnType<typeof setTimeout> | null = null;
  private reportedReconnectLoops = 0;

  private inspectorEvents: RealtimeInspectorEvent[] = [];
  private inspectorListeners = new Set<InspectorListener>();
  private inspectorSeq = 0;
  private static readonly INSPECTOR_MAX_EVENTS = 100;

  connect(): void {
    if (typeof WebSocket === "undefined" || this.socket) return;
    this.closedByUser = false;
    if (this.negotiated) {
      this.open();
      return;
    }
    void this.negotiate();
  }

  private async negotiate(): Promise<void> {
    const capability = await getRealtimeCapability();
    this.negotiated = true;
    if (this.closedByUser) return;
    if (capability.transport === "websocket") {
      this.open();
    }
    // SSE and REST-only transports are handled elsewhere; this client only
    // manages the WebSocket transport.
  }

  getState(): RealtimeConnectionState {
    return this.state;
  }

  /**
   * Registers a wallet-scoped subscription that will be replayed after a
   * successful re-authentication.
   */
  registerAuthenticatedSubscription(sub: AuthenticatedSubscription): void {
    this.authenticatedSubscriptions.set(sub.topic, sub);
  }

  unregisterAuthenticatedSubscription(topic: string): void {
    this.authenticatedSubscriptions.delete(topic);
  }

  async connect(): Promise<void> {
    this.setState('connecting');
    const token = await this.resolveToken();
    this.openSocket(token);
  }

  disconnect(): void {
    this.socket?.close(1000, 'client disconnect');
    this.socket = null;
    this.setState('closed');
  }

  private async resolveToken(): Promise<string | null> {
    if (!this.auth) return null;
    try {
      return await this.auth.getAuthToken();
    } catch {
      return null;
    }
  }

  private openSocket(token: string | null): void {
    const url = token ? this.withToken(this.url, token) : this.url;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.refreshAttempts = 0;
      this.setState('connected');
      this.replaySubscriptions();
    };

    socket.onmessage = (event) => {
      if (this.isAuthErrorFrame(event.data)) {
        void this.handleAuthFailure();
      }
    };

    socket.onclose = (event) => {
      if (this.isAuthCloseCode(event.code)) {
        void this.handleAuthFailure();
        return;
      }
      this.setState('closed');
    };

    socket.onerror = () => {
      // Errors surface via onclose; nothing to do here.
    };
  }

  private isAuthCloseCode(code: RealtimeCloseCode): boolean {
    return AUTH_CLOSE_CODES.has(code);
  }

  private isAuthErrorFrame(data: unknown): boolean {
    if (typeof data !== 'string') return false;
    try {
      const parsed = JSON.parse(data) as { type?: string; code?: number };
      if (parsed?.type === 'error' && typeof parsed.code === 'number') {
        return AUTH_CLOSE_CODES.has(parsed.code);
      }
      return parsed?.type === 'auth_error';
    } catch {
      return false;
    }
  }

  /**
   * Handles an auth failure by refreshing the token and replaying
   * wallet-scoped subscriptions. Guards against refresh loops and dedupes
   * concurrent refreshes.
   */
  private async handleAuthFailure(): Promise<void> {
    if (!this.auth) {
      this.enterDegraded('auth-required', 'Authentication required for this subscription.');
      return;
    }

    if (this.refreshAttempts >= this.maxRefreshAttempts) {
      this.enterDegraded('auth-refresh-loop', 'Unable to re-authenticate. Showing cached data.');
      return;
    }

    this.refreshAttempts += 1;
    this.setState('reconnecting');

    const token = await this.refreshTokenDeduped();
    if (!token) {
      this.enterDegraded('auth-refresh-failed', 'Session expired. Falling back to REST.');
      return;
    }

    this.socket?.close(1000, 'reauth');
    this.openSocket(token);
  }

  /**
   * Dedupes concurrent refresh requests so multiple failing subscriptions
   * share a single refresh call.
   */
  private refreshTokenDeduped(): Promise<string | null> {
    if (this.refreshInFlight) return this.refreshInFlight;
    if (!this.auth) return Promise.resolve(null);

    this.refreshInFlight = this.auth
      .refreshAuthToken()
      .catch(() => null)
      .finally(() => {
        this.refreshInFlight = null;
      });

    return this.refreshInFlight;
  }

  private replaySubscriptions(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    for (const sub of this.authenticatedSubscriptions.values()) {
      this.socket.send(
        JSON.stringify({ type: 'subscribe', topic: sub.topic, wallet: sub.wallet, params: sub.params }),
      );
    }
  }

  private enterDegraded(
    reason: RealtimeDegradedState['reason'],
    message: string,
  ): void {
    this.setState('degraded');
    this.onDegraded?.({ reason, fallbackToRest: true, message });
  }

  private withToken(url: string, token: string): string {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('token', token);
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private setState(state: RealtimeConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange?.(state);
  }

  private open(): void {
    const wsUrl = API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1$/, "/ws");
    this.updateHealth({ status: this.attempt > 0 ? "reconnecting" : "connecting" });
    try {
      this.socket = new WebSocket(wsUrl);
    } catch (err) {
      this.recordError(err);
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener("open", () => {
      this.attempt = 0;
      this.reportedReconnectLoops = 0;
      this.updateHealth({ status: "open", attempt: 0 });
      this.resubscribe();
    });
    this.socket.addEventListener("message", (event) => {
      try {
        const { topic, payload, seq } = JSON.parse(event.data as string) as {
          topic: string;
          payload: unknown;
          seq?: number;
        };
        if (typeof seq === "number") this.setCursor(topic, seq);
        this.recordInspectorEvent({
          topic,
          seq: typeof seq === "number" ? seq : null,
          direction: "in",
          payload,
        });
        this.handlers.get(topic)?.forEach((handler) => handler(payload));
        this.markMessageReceived();
      } catch {
        // Malformed message — ignore, don't crash the connection.
      }
    });
    this.socket.addEventListener("close", () => {
      this.socket = null;
      if (!this.closedByUser) {
        this.updateHealth({ status: "reconnecting" });
        this.scheduleReconnect();
      }
    });
    this.socket.addEventListener("error", (event) => {
      this.recordError(event);
      this.socket?.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.updateHealth({ status: "reconnecting", attempt: this.attempt });
    this.reportReconnectLoop();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.open();
    }, delay);
  }

  private resubscribe(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    for (const topic of this.handlers.keys()) {
      const since = this.cursors.get(topic);
      this.sendSubscribe(topic, since);
    }
  }

  private sendSubscribe(topic: string, since: number | undefined): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: "subscribe", topic, since }));
    this.recordInspectorEvent({
      topic,
      seq: typeof since === "number" ? since : null,
      direction: "out",
      payload: { type: "subscribe", topic, since },
    });
  }

  private setCursor(topic: string, seq: number): void {
    const current = this.cursors.get(topic);
    if (current !== undefined && seq <= current) return;
    this.cursors.set(topic, seq);
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(`${CURSOR_STORAGE_PREFIX}${topic}`, String(seq));
      }
    } catch {
      // Storage unavailable — in-memory cursor still works for this session.
    }
  }

  private loadCursor(topic: string): number | undefined {
    const inMemory = this.cursors.get(topic);
    if (inMemory !== undefined) return inMemory;
    try {
      if (typeof sessionStorage !== "undefined") {
        const raw = sessionStorage.getItem(`${CURSOR_STORAGE_PREFIX}${topic}`);
        if (raw !== null) {
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) {
            this.cursors.set(topic, parsed);
            return parsed;
          }
        }
      }
    } catch {
      // Storage unavailable — fall through to no cursor.
    }
    return undefined;
  }

  /**
   * Returns the last-applied cursor for a topic, if any. Consumers use this
   * to request a REST snapshot and replay events newer than the cursor.
   */
  getCursor(topic: string): number | undefined {
    return this.loadCursor(topic);
  }

  /**
   * Clears the stored cursor for a topic. Call this when falling back to a
   * fresh snapshot because replay is unavailable or the cursor is too old.
   */
  resetCursor(topic: string): void {
    this.cursors.delete(topic);
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem(`${CURSOR_STORAGE_PREFIX}${topic}`);
      }
    } catch {
      // Storage unavailable — nothing to clear.
    }
  }

  /**
   * Dev-only tap point: records a message into the bounded inspector ring
   * buffer and notifies inspector listeners with a stable snapshot. This is
   * a passive observer and never touches the socket or subscriptions.
   */
  private recordInspectorEvent(
    event: Omit<RealtimeInspectorEvent, "id" | "timestamp">,
  ): void {
    if (this.inspectorListeners.size === 0) return;
    this.inspectorSeq += 1;
    const entry: RealtimeInspectorEvent = {
      ...event,
      id: this.inspectorSeq,
      timestamp: Date.now(),
    };
    const next = [...this.inspectorEvents, entry];
    this.inspectorEvents =
      next.length > RealtimeClient.INSPECTOR_MAX_EVENTS
        ? next.slice(next.length - RealtimeClient.INSPECTOR_MAX_EVENTS)
        : next;
    const snapshot = this.inspectorEvents;
    this.inspectorListeners.forEach((listener) => listener(snapshot));
  }

  /**
   * Subscribes to the dev inspector event stream. Returns the current
   * snapshot immediately and an unsubscribe function. Does not open or
   * resubscribe the socket.
   */
  subscribeInspector(listener: InspectorListener): () => void {
    this.inspectorListeners.add(listener);
    listener(this.inspectorEvents);
    return () => {
      this.inspectorListeners.delete(listener);
    };
  }

  subscribe(topic: string, handler: Handler): () => void {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler);
    this.loadCursor(topic);
    this.connect();

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.sendSubscribe(topic, this.cursors.get(topic));
    }

    return () => {
      this.handlers.get(topic)?.delete(handler);
    };
  }
}

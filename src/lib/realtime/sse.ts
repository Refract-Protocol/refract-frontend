import { API_BASE_URL } from "../api/client";

export type ActiveRealtimeTransportKind = "websocket" | "sse" | "none";
export type TransportConnectionState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface RealtimeMessageEnvelope {
  topic: string;
  payload: unknown;
  id?: string;
  seq?: number;
  ts?: number;
}

export type RealtimeMessageHandler = (message: RealtimeMessageEnvelope) => void;
export type RealtimeTopicHandler = (payload: unknown) => void;

export interface RealtimeTransport {
  readonly kind: "websocket" | "sse";
  connect(): void;
  send(data: Record<string, unknown>): void;
  close(): void;
  onMessage(handler: RealtimeMessageHandler): () => void;
  getState(): TransportConnectionState;
}

export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface SseTransportOptions {
  baseUrl?: string;
  topics?: string[];
  cursors?: Record<string, number>;
  authToken?: string;
  walletAddress?: string;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  eventSourceFactory?: EventSourceFactory;
  onControlSend?: (url: string, body: Record<string, unknown>) => Promise<void>;
}

/**
 * Builds the SSE endpoint URL encoding subscribed topics, resume cursors, and
 * optional wallet-scoped authentication parameters in the query string because
 * browser `EventSource` is unidirectional and does not support custom headers.
 */
export function buildSseUrl(options: {
  baseUrl?: string;
  topics: ReadonlySet<string>;
  cursors: Readonly<Record<string, number>>;
  authToken?: string;
  walletAddress?: string;
}): string {
  const rawBase = (options.baseUrl ?? API_BASE_URL).replace(/\/api\/v1\/?$/, "");
  const endpoint = `${rawBase.replace(/\/$/, "")}/events`;
  const params = new URLSearchParams();

  const sortedTopics = Array.from(options.topics).sort();
  if (sortedTopics.length > 0) {
    params.set("topics", sortedTopics.join(","));
  }

  const cursorEntries = Object.entries(options.cursors).sort(([a], [b]) => a.localeCompare(b));
  for (const [topic, seq] of cursorEntries) {
    params.set(`cursor[${topic}]`, String(seq));
  }

  if (options.walletAddress) {
    params.set("wallet", options.walletAddress);
  }
  if (options.authToken) {
    params.set("token", options.authToken);
  }

  const query = params.toString();
  return query ? `${endpoint}?${query}` : endpoint;
}

/**
 * Server-Sent Events (`EventSource`) transport satisfying the shared
 * `RealtimeTransport` contract. Because `EventSource` is unidirectional,
 * outbound `subscribe`/`unsubscribe` mutations either re-open the stream with
 * updated query parameters or dispatch via an optional `onControlSend` hook.
 * Native `EventSource` auto-reconnect is explicitly closed on error so the
 * transport's bounded backoff controller remains the single retry owner.
 */
export class SseRealtimeTransport implements RealtimeTransport {
  readonly kind = "sse" as const;

  private source: EventSourceLike | null = null;
  private state: TransportConnectionState = "idle";
  private closedByUser = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageHandlers = new Set<RealtimeMessageHandler>();
  private topicHandlers = new Map<string, Set<RealtimeTopicHandler>>();
  private topics: Set<string>;
  private cursors: Record<string, number>;
  private authToken?: string;
  private walletAddress?: string;
  private readonly baseUrl?: string;
  private readonly reconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private readonly eventSourceFactory: EventSourceFactory;
  private readonly onControlSend?: (url: string, body: Record<string, unknown>) => Promise<void>;

  constructor(options: SseTransportOptions = {}) {
    this.baseUrl = options.baseUrl;
    this.topics = new Set(options.topics ?? []);
    this.cursors = { ...(options.cursors ?? {}) };
    this.authToken = options.authToken;
    this.walletAddress = options.walletAddress;
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30_000;
    this.onControlSend = options.onControlSend;
    this.eventSourceFactory =
      options.eventSourceFactory ??
      ((url: string) => {
        if (typeof EventSource === "undefined") {
          throw new Error("EventSource is not available in this runtime");
        }
        return new EventSource(url);
      });
  }

  getState(): TransportConnectionState {
    return this.state;
  }

  getCurrentUrl(): string {
    return buildSseUrl({
      baseUrl: this.baseUrl,
      topics: this.topics,
      cursors: this.cursors,
      authToken: this.authToken,
      walletAddress: this.walletAddress,
    });
  }

  setAuth(credentials: { walletAddress?: string; authToken?: string }): void {
    this.walletAddress = credentials.walletAddress;
    this.authToken = credentials.authToken;
    if (this.source && !this.closedByUser) {
      this.reopenWithUpdatedParams();
    }
  }

  connect(): void {
    if (this.source) return;
    this.closedByUser = false;
    this.open();
  }

  private open(): void {
    this.state = this.attempt > 0 ? "reconnecting" : "connecting";
    const url = this.getCurrentUrl();

    try {
      this.source = this.eventSourceFactory(url);
    } catch {
      this.source = null;
      this.scheduleReconnect();
      return;
    }

    this.source.onopen = () => {
      this.attempt = 0;
      this.state = "open";
    };

    this.source.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(event.data)) as RealtimeMessageEnvelope;
        if (!parsed || typeof parsed.topic !== "string") return;
        if (typeof parsed.seq === "number") {
          this.cursors[parsed.topic] = parsed.seq;
        }
        this.messageHandlers.forEach((handler) => handler(parsed));
        this.topicHandlers.get(parsed.topic)?.forEach((handler) => handler(parsed.payload));
      } catch {
        // Ignore malformed SSE data frames without tearing down the stream.
      }
    };

    this.source.onerror = () => {
      // Close the underlying EventSource so browser auto-retry does not race
      // against our explicit backoff scheduler.
      this.source?.close();
      this.source = null;
      if (!this.closedByUser) {
        this.scheduleReconnect();
      }
    };
  }

  private reopenWithUpdatedParams(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.source?.close();
    this.source = null;
    this.open();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closedByUser) return;
    this.state = "reconnecting";
    const delay = Math.min(this.reconnectDelayMs * 2 ** this.attempt, this.maxReconnectDelayMs);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) {
        this.open();
      }
    }, delay);
  }

  send(data: Record<string, unknown>): void {
    if (data.type === "subscribe" && Array.isArray(data.topics)) {
      let changed = false;
      for (const topic of data.topics) {
        if (typeof topic === "string" && !this.topics.has(topic)) {
          this.topics.add(topic);
          changed = true;
        }
      }
      if (data.auth && typeof data.auth === "object") {
        const auth = data.auth as { walletAddress?: string; token?: string };
        if (auth.walletAddress) this.walletAddress = auth.walletAddress;
        if (auth.token) this.authToken = auth.token;
        changed = true;
      }
      if (changed && this.source && !this.closedByUser) {
        this.reopenWithUpdatedParams();
      }
      return;
    }

    if (data.type === "unsubscribe" && Array.isArray(data.topics)) {
      let changed = false;
      for (const topic of data.topics) {
        if (typeof topic === "string" && this.topics.delete(topic)) {
          changed = true;
        }
      }
      if (changed && this.source && !this.closedByUser) {
        this.reopenWithUpdatedParams();
      }
      return;
    }

    if (this.onControlSend) {
      const controlUrl = `${(this.baseUrl ?? API_BASE_URL).replace(/\/$/, "")}/events/control`;
      void this.onControlSend(controlUrl, data);
    }
  }

  subscribe(topic: string, handler: RealtimeTopicHandler): () => void {
    if (!this.topicHandlers.has(topic)) {
      this.topicHandlers.set(topic, new Set());
    }
    this.topicHandlers.get(topic)!.add(handler);

    const wasNewTopic = !this.topics.has(topic);
    this.topics.add(topic);

    if (!this.source) {
      this.connect();
    } else if (wasNewTopic && !this.closedByUser) {
      this.reopenWithUpdatedParams();
    }

    return () => {
      const set = this.topicHandlers.get(topic);
      set?.delete(handler);
      if (set && set.size === 0) {
        this.topicHandlers.delete(topic);
        this.topics.delete(topic);
      }
    };
  }

  onMessage(handler: RealtimeMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  close(): void {
    this.closedByUser = true;
    this.state = "closed";
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.source?.close();
    this.source = null;
  }
}

export interface FallbackRealtimeTransportOptions {
  createPrimary: () => RealtimeTransport & {
    onHandshakeFailed?: (cb: () => void) => void;
  };
  createFallback: () => SseRealtimeTransport;
}

/**
 * Runtime transport selector that prefers WebSocket and falls back to SSE when
 * the initial WebSocket handshake fails or WebSockets are unavailable.
 */
export class NegotiatedRealtimeTransport {
  private activeTransport: RealtimeTransport | null = null;
  private activeKind: ActiveRealtimeTransportKind = "none";
  private readonly messageHandlers = new Set<RealtimeMessageHandler>();
  private readonly createPrimary: FallbackRealtimeTransportOptions["createPrimary"];
  private readonly createFallback: FallbackRealtimeTransportOptions["createFallback"];
  private unsubscribeActiveMessage: (() => void) | null = null;

  constructor(options: FallbackRealtimeTransportOptions) {
    this.createPrimary = options.createPrimary;
    this.createFallback = options.createFallback;
  }

  getActiveTransportKind(): ActiveRealtimeTransportKind {
    return this.activeKind;
  }

  connect(): void {
    if (this.activeTransport) return;

    try {
      const primary = this.createPrimary();
      this.attachTransport(primary);
      primary.onHandshakeFailed?.(() => {
        if (this.activeKind === "websocket") {
          this.switchToFallback();
        }
      });
      primary.connect();
    } catch {
      this.switchToFallback();
    }
  }

  switchToFallback(): void {
    this.unsubscribeActiveMessage?.();
    this.activeTransport?.close();
    const fallback = this.createFallback();
    this.attachTransport(fallback);
    fallback.connect();
  }

  private attachTransport(transport: RealtimeTransport): void {
    this.activeTransport = transport;
    this.activeKind = transport.kind;
    this.unsubscribeActiveMessage = transport.onMessage((msg) => {
      this.messageHandlers.forEach((handler) => handler(msg));
    });
  }

  send(data: Record<string, unknown>): void {
    this.activeTransport?.send(data);
  }

  onMessage(handler: RealtimeMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  close(): void {
    this.unsubscribeActiveMessage?.();
    this.unsubscribeActiveMessage = null;
    this.activeTransport?.close();
    this.activeTransport = null;
    this.activeKind = "none";
  }
}

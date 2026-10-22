import { defaultTransportFactories } from "./capabilities";
import type { DecodeFailureKind, DecodeResult } from "./decode";
import { DedupeCache, type DedupeStats } from "./dedupe";
import { FrameDecoder, OrderedQueue, type DecoderStats } from "./frameDecoder";
import {
  AUTH_CLOSE_CODES,
  AUTH_ERROR_CODES,
  type ControlFrame,
  type Cursors,
  type DataEvent,
} from "./topics";
import type {
  RealtimeTransport,
  TransportCloseInfo,
  TransportFactory,
  TransportKind,
} from "./transports/types";

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  /** Realtime is unavailable; callers should rely on REST polling. */
  | "degraded"
  | "closed";

export type DegradedReason = "auth" | "no_transport" | "subscribe_timeout";

export interface EventMeta {
  topic: string;
  id?: string;
  seq?: number;
}

export type Handler = (payload: unknown, meta: EventMeta) => void;

export interface GapInfo {
  topic: string;
  /** `resume`: the server could not replay from our cursor. `sequence`: we saw a seq jump mid-stream. */
  reason: "resume" | "sequence";
}

export type GapHandler = (gap: GapInfo) => void;

export interface NegotiationRecord {
  kind: TransportKind;
  outcome: "unsupported" | "failed" | "selected";
}

export interface RealtimeStats {
  status: RealtimeStatus;
  degradedReason: DegradedReason | null;
  transport: TransportKind | null;
  negotiation: NegotiationRecord[];
  connects: number;
  reconnects: number;
  idleTimeouts: number;
  subscribeRetries: number;
  eventsDelivered: number;
  sequenceGaps: number;
  resumeGaps: number;
  decodeErrors: Record<DecodeFailureKind, number>;
  decoder: DecoderStats;
  dedupe: DedupeStats;
}

export interface RealtimeClientOptions {
  /** Transport tiers in preference order. */
  transports?: TransportFactory[];
  decoder?: FrameDecoder;
  dedupe?: DedupeCache;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** No frame (data or ping) for this long ⇒ assume a half-open connection and reconnect. 0 disables. */
  idleTimeoutMs?: number;
  /** How long to wait for the server to acknowledge a subscribe. */
  subscribeAckTimeoutMs?: number;
  /** Unacknowledged subscribe attempts before degrading to REST. */
  maxSubscribeAttempts?: number;
  /** Failed opens (without ever opening) before falling to the next transport tier. */
  maxOpenFailuresPerTransport?: number;
  /** Delay before retrying after a non-auth degradation. */
  degradedRetryMs?: number;
  /** Never connect outside a browser (e.g. during SSR). */
  browserOnly?: boolean;
}

const DEFAULTS = {
  backoffBaseMs: 1_000,
  backoffMaxMs: 30_000,
  idleTimeoutMs: 45_000,
  subscribeAckTimeoutMs: 10_000,
  maxSubscribeAttempts: 3,
  maxOpenFailuresPerTransport: 2,
  degradedRetryMs: 60_000,
  browserOnly: false,
};

/**
 * Transport-agnostic realtime client with a subscribe-by-topic API.
 *
 * Pipeline for every inbound frame, whichever transport delivered it:
 *   transport → FrameDecoder (worker or main thread, order preserved)
 *             → contract validation → DedupeCache (by event id)
 *             → resume cursor (per-topic seq) → topic handlers
 *
 * Callers must treat realtime as best-effort and keep an independent REST
 * fetch as the source of truth; `degraded` status and gap callbacks tell them
 * when to lean on it.
 */
export class RealtimeClient {
  private readonly o: Required<Omit<RealtimeClientOptions, "decoder" | "dedupe">>;
  private readonly decoder: FrameDecoder;
  private readonly dedupe: DedupeCache;
  private readonly queue: OrderedQueue<DecodeResult>;

  private handlers = new Map<string, Set<Handler>>();
  private gapHandlers = new Map<string, Set<GapHandler>>();
  private statusListeners = new Set<(status: RealtimeStatus) => void>();
  private cursors: Cursors = {};

  private transport: RealtimeTransport | null = null;
  private transportGeneration = 0;
  private tierIndex = 0;
  private openFailures = 0;
  private everOpened = new Set<TransportKind>();
  private attempt = 0;
  private subscribeAttempts = 0;
  private closedByUser = true;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;

  private stats: Omit<RealtimeStats, "decoder" | "dedupe"> = {
    status: "idle",
    degradedReason: null,
    transport: null,
    negotiation: [],
    connects: 0,
    reconnects: 0,
    idleTimeouts: 0,
    subscribeRetries: 0,
    eventsDelivered: 0,
    sequenceGaps: 0,
    resumeGaps: 0,
    decodeErrors: { too_large: 0, invalid_json: 0, invalid_shape: 0 },
  };

  constructor(options: RealtimeClientOptions = {}) {
    this.o = {
      transports: options.transports ?? defaultTransportFactories(),
      backoffBaseMs: options.backoffBaseMs ?? DEFAULTS.backoffBaseMs,
      backoffMaxMs: options.backoffMaxMs ?? DEFAULTS.backoffMaxMs,
      idleTimeoutMs: options.idleTimeoutMs ?? DEFAULTS.idleTimeoutMs,
      subscribeAckTimeoutMs: options.subscribeAckTimeoutMs ?? DEFAULTS.subscribeAckTimeoutMs,
      maxSubscribeAttempts: options.maxSubscribeAttempts ?? DEFAULTS.maxSubscribeAttempts,
      maxOpenFailuresPerTransport:
        options.maxOpenFailuresPerTransport ?? DEFAULTS.maxOpenFailuresPerTransport,
      degradedRetryMs: options.degradedRetryMs ?? DEFAULTS.degradedRetryMs,
      browserOnly: options.browserOnly ?? DEFAULTS.browserOnly,
    };
    this.decoder = options.decoder ?? new FrameDecoder();
    this.dedupe = options.dedupe ?? new DedupeCache();
    this.queue = new OrderedQueue((result) => this.handleDecoded(result));
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get status(): RealtimeStatus {
    return this.stats.status;
  }

  connect(): void {
    if (this.o.browserOnly && typeof window === "undefined") return;
    if (!this.closedByUser) return;
    this.closedByUser = false;
    this.open();
  }

  subscribe(topic: string, handler: Handler, onGap?: GapHandler): () => void {
    let set = this.handlers.get(topic);
    const isNewTopic = !set || set.size === 0;
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
    }
    set.add(handler);
    if (onGap) {
      if (!this.gapHandlers.has(topic)) this.gapHandlers.set(topic, new Set());
      this.gapHandlers.get(topic)!.add(onGap);
    }

    if (isNewTopic && this.stats.status === "open") this.sendSubscribe([topic]);
    this.connect();

    return () => {
      const current = this.handlers.get(topic);
      current?.delete(handler);
      if (onGap) this.gapHandlers.get(topic)?.delete(onGap);
      if (current && current.size === 0) {
        this.handlers.delete(topic);
        this.gapHandlers.delete(topic);
        this.transport?.unsubscribe([topic]);
      }
    };
  }

  onStatusChange(listener: (status: RealtimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  disconnect(): void {
    this.closedByUser = true;
    this.clearTimers();
    this.dropTransport();
    this.queue.clear();
    this.setStatus("idle");
  }

  /**
   * Call on account or network switch: forgets seen event ids and resume
   * cursors (they belong to the previous identity) and reconnects fresh.
   */
  resetSession(): void {
    this.dedupe.reset();
    this.cursors = {};
    this.queue.clear();
    if (this.closedByUser) return;
    this.clearTimers();
    this.dropTransport();
    this.stats.degradedReason = null;
    this.tierIndex = 0;
    this.openFailures = 0;
    this.attempt = 0;
    this.open();
  }

  getCursors(): Cursors {
    return { ...this.cursors };
  }

  getStats(): RealtimeStats {
    return {
      ...this.stats,
      negotiation: [...this.stats.negotiation],
      decodeErrors: { ...this.stats.decodeErrors },
      decoder: { ...this.decoder.stats },
      dedupe: this.dedupe.getStats(),
    };
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────

  private open(): void {
    const factory = this.nextSupportedFactory();
    if (!factory) {
      this.degrade("no_transport");
      return;
    }

    const transport = factory.create();
    const generation = ++this.transportGeneration;
    const isCurrent = () => generation === this.transportGeneration;
    this.transport = transport;
    this.stats.connects += 1;
    this.setStatus(this.stats.connects > 1 ? "reconnecting" : "connecting");

    transport.connect(
      { topics: this.activeTopics(), getCursors: () => this.getCursors() },
      {
        onOpen: () => isCurrent() && this.handleOpen(transport),
        onFrame: (frame) => isCurrent() && this.handleFrame(frame),
        onClose: (info) => isCurrent() && this.handleClose(transport, info),
      }
    );
  }

  /** Skips tiers the environment cannot run, recording each decision. */
  private nextSupportedFactory(): TransportFactory | null {
    while (this.tierIndex < this.o.transports.length) {
      const factory = this.o.transports[this.tierIndex]!;
      if (factory.isSupported()) return factory;
      this.recordNegotiation(factory.kind, "unsupported");
      this.tierIndex += 1;
    }
    return null;
  }

  private handleOpen(transport: RealtimeTransport): void {
    if (!this.everOpened.has(transport.kind)) {
      this.everOpened.add(transport.kind);
      this.recordNegotiation(transport.kind, "selected");
    }
    this.stats.transport = transport.kind;
    this.stats.degradedReason = null;
    this.attempt = 0;
    this.openFailures = 0;
    this.subscribeAttempts = 0;
    this.setStatus("open");
    this.armIdle();
    this.sendSubscribe(this.activeTopics());
  }

  private handleClose(transport: RealtimeTransport, info: TransportCloseInfo): void {
    this.transport = null;
    this.clearTimers();
    if (this.closedByUser) return;

    if (info.auth || AUTH_CLOSE_CODES.has(info.code)) {
      this.degrade("auth");
      return;
    }

    if (info.unsupported || !this.everOpened.has(transport.kind)) {
      this.openFailures += 1;
      if (info.unsupported || this.openFailures >= this.o.maxOpenFailuresPerTransport) {
        this.recordNegotiation(transport.kind, "failed");
        this.tierIndex += 1;
        this.openFailures = 0;
        this.attempt = 0;
        if (!this.nextSupportedFactory()) {
          this.degrade("no_transport");
          return;
        }
        // Moving to a new tier: try it straight away rather than backing off.
        this.setStatus("reconnecting");
        this.scheduleReconnect(0);
        return;
      }
    }

    this.stats.reconnects += 1;
    this.setStatus("reconnecting");
    this.scheduleReconnect();
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.reconnectTimer) return;
    const delay =
      delayMs ?? Math.min(this.o.backoffBaseMs * 2 ** this.attempt, this.o.backoffMaxMs);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.open();
    }, delay);
  }

  private degrade(reason: DegradedReason): void {
    this.clearTimers();
    this.dropTransport();
    this.stats.degradedReason = reason;
    this.stats.transport = null;
    this.setStatus("degraded");
    // Auth failures need a new session (resetSession) before retrying.
    if (reason === "auth") return;
    // Otherwise try the full tier list again later; REST covers the meantime.
    this.tierIndex = 0;
    this.openFailures = 0;
    this.attempt = 0;
    this.scheduleReconnect(this.o.degradedRetryMs);
  }

  private dropTransport(): void {
    this.transportGeneration += 1;
    const transport = this.transport;
    this.transport = null;
    transport?.disconnect();
  }

  // ── Subscription acknowledgement ─────────────────────────────────────────

  private sendSubscribe(topics: string[]): void {
    if (!this.transport || topics.length === 0) return;
    this.transport.subscribe(topics, this.cursors);
    this.armAck();
  }

  private armAck(): void {
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null;
      this.subscribeAttempts += 1;
      if (this.subscribeAttempts >= this.o.maxSubscribeAttempts) {
        this.degrade("subscribe_timeout");
        return;
      }
      // The server may have lost our subscription (e.g. restarted); resend all.
      this.stats.subscribeRetries += 1;
      this.sendSubscribe(this.activeTopics());
    }, this.o.subscribeAckTimeoutMs);
  }

  // ── Inbound frames ───────────────────────────────────────────────────────

  private handleFrame(frame: unknown): void {
    this.armIdle();
    this.queue.push(this.decoder.decode(frame));
  }

  private handleDecoded(result: DecodeResult): void {
    if (!result.ok) {
      this.stats.decodeErrors[result.error.kind] += 1;
      return;
    }
    const message = result.message;
    if (message.kind === "control") this.handleControl(message);
    else this.handleEvent(message);
  }

  private handleControl(frame: ControlFrame): void {
    switch (frame.type) {
      case "subscribed":
        if (this.ackTimer) clearTimeout(this.ackTimer);
        this.ackTimer = null;
        this.subscribeAttempts = 0;
        for (const topic of frame.gap ?? []) {
          this.stats.resumeGaps += 1;
          this.emitGap({ topic, reason: "resume" });
        }
        return;
      case "error":
        if (AUTH_ERROR_CODES.has(frame.code)) this.degrade("auth");
        return;
      case "ping":
        this.transport?.send({ type: "pong" });
        return;
    }
  }

  private handleEvent(event: DataEvent): void {
    const handlers = this.handlers.get(event.topic);
    if (!handlers || handlers.size === 0) return;

    if (this.dedupe.check(event.topic, event.id) === "duplicate") return;

    if (event.seq !== undefined) {
      const last = this.cursors[event.topic];
      if (last !== undefined && event.seq > last + 1) {
        this.stats.sequenceGaps += 1;
        this.emitGap({ topic: event.topic, reason: "sequence" });
      }
      if (last === undefined || event.seq > last) this.cursors[event.topic] = event.seq;
    }

    this.stats.eventsDelivered += 1;
    const meta: EventMeta = { topic: event.topic, id: event.id, seq: event.seq };
    for (const handler of [...handlers]) {
      try {
        handler(event.payload, meta);
      } catch (err) {
        // One faulty consumer must not starve the others.
        console.error(`[realtime] handler for "${event.topic}" threw`, err);
      }
    }
  }

  private emitGap(gap: GapInfo): void {
    this.gapHandlers.get(gap.topic)?.forEach((handler) => {
      try {
        handler(gap);
      } catch (err) {
        console.error(`[realtime] gap handler for "${gap.topic}" threw`, err);
      }
    });
  }

  // ── Half-open detection ──────────────────────────────────────────────────

  private armIdle(): void {
    // Long-poll is quiet between held requests by design; its per-request
    // timeout already covers dead connections.
    if (this.o.idleTimeoutMs <= 0 || this.transport?.kind === "long-poll") return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      const transport = this.transport;
      if (!transport) return;
      this.stats.idleTimeouts += 1;
      this.dropTransport();
      this.handleClose(transport, { code: 4000, reason: "idle timeout" });
    }, this.o.idleTimeoutMs);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private activeTopics(): string[] {
    return [...this.handlers.entries()].filter(([, set]) => set.size > 0).map(([topic]) => topic);
  }

  private clearTimers(): void {
    for (const timer of [this.reconnectTimer, this.idleTimer, this.ackTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.reconnectTimer = this.idleTimer = this.ackTimer = null;
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.stats.status === status) return;
    this.stats.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }

  private recordNegotiation(kind: TransportKind, outcome: NegotiationRecord["outcome"]): void {
    this.stats.negotiation.push({ kind, outcome });
  }
}

export function createRealtimeClient(options?: RealtimeClientOptions): RealtimeClient {
  return new RealtimeClient(options);
}

/** App-wide singleton. Lazily connects on the first `subscribe()`. */
export const realtimeClient = new RealtimeClient({ browserOnly: true });

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __refractRealtime?: RealtimeClient }).__refractRealtime = realtimeClient;
}

import { API_BASE_URL } from "@/lib/api/client";
import { ClockOffsetEstimator, defaultClock } from "./clockOffset";
import {
  decodeFrame,
  MAX_MESSAGE_BYTES,
  RealtimeProtocolError,
  type RealtimeEnvelope,
} from "./codec";
import { INTERNAL_TOPICS, isInternalTopic } from "./topics";

/**
 * Reconnecting WebSocket client with a subscribe-by-topic API.
 *
 * Do not import this module from UI code directly: load it through
 * `loadRealtime()` in ./load so it stays out of the initial bundle (#248).
 *
 * Backend contract (docs/realtime.md):
 *  - JSON text frames shaped `{ topic, payload, ts? }`.
 *  - Answers `refract.ping { t0 }` with `refract.pong { t0, serverTs }`.
 *  - Should accept `permessage-deflate` with no context takeover.
 *
 * The connection is best-effort: callers keep REST as the source of truth
 * for initial state.
 */

export type TopicHandler = (payload: unknown, envelope: RealtimeEnvelope) => void;
export type ProtocolErrorListener = (error: RealtimeProtocolError) => void;

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

/** Keepalive + clock-sync ping interval. */
export const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * `permessage-deflate` parameters we ask for (RFC 7692). Browsers negotiate
 * the extension themselves during the HTTP upgrade and give script no way to
 * change the offer, so in a browser this is documentation for the backend
 * config. Non-browser WebSocket implementations that take an options argument
 * (e.g. `ws` in Node tooling and tests) receive it as the third constructor
 * argument; browsers ignore extra arguments.
 *
 * No context takeover keeps per-connection memory flat on both ends, which is
 * the conservative choice for mobile clients.
 */
export const PERMESSAGE_DEFLATE_OPTIONS = {
  perMessageDeflate: {
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
  },
} as const;

export interface RealtimeDiagnostics {
  /** `WebSocket.extensions` from the last handshake ("" if the server declined all extensions). */
  negotiatedExtensions: string;
  /** True when the server accepted `permessage-deflate`. */
  compressionActive: boolean;
  /** Frames accepted and dispatched (including internal ones). */
  framesReceived: number;
  /** Decoded (uncompressed) bytes of accepted frames. */
  bytesReceived: number;
  /** Frames dropped for exceeding `maxMessageBytes`. */
  oversizeDrops: number;
  /** Frames dropped as malformed or of an unsupported type. */
  malformedDrops: number;
  /**
   * Server-reported cumulative wire stats (`refract.wire_stats`). Browsers do
   * not expose compressed byte counts to script, so this is the only source
   * for the compressed size. Null until the server reports it.
   */
  wireStats: { compressedBytes: number; uncompressedBytes: number } | null;
  /** Last protocol error, for debugging. */
  lastError: { code: RealtimeProtocolError["code"]; message: string; at: number } | null;
}

type WebSocketCtor = new (
  url: string,
  protocols?: string | string[],
  options?: unknown
) => WebSocket;

export interface RealtimeClientOptions {
  url?: string;
  /** WebSocket implementation. Defaults to the global `WebSocket`. */
  WebSocketImpl?: WebSocketCtor;
  /** Inbound frame size ceiling in bytes. Defaults to `MAX_MESSAGE_BYTES`. */
  maxMessageBytes?: number;
  /** Clock estimator fed by heartbeat round trips. Defaults to the app-wide one. */
  clock?: ClockOffsetEstimator;
  heartbeatIntervalMs?: number;
}

const freshDiagnostics = (): RealtimeDiagnostics => ({
  negotiatedExtensions: "",
  compressionActive: false,
  framesReceived: 0,
  bytesReceived: 0,
  oversizeDrops: 0,
  malformedDrops: 0,
  wireStats: null,
  lastError: null,
});

export function defaultRealtimeUrl(): string {
  return API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1$/, "/ws");
}

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<TopicHandler>>();
  private errorListeners = new Set<ProtocolErrorListener>();
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private diagnostics = freshDiagnostics();

  private readonly url: string;
  private readonly WebSocketImpl: WebSocketCtor | undefined;
  private readonly maxMessageBytes: number;
  private readonly clock: ClockOffsetEstimator;
  private readonly heartbeatIntervalMs: number;

  constructor(options: RealtimeClientOptions = {}) {
    this.url = options.url ?? defaultRealtimeUrl();
    this.WebSocketImpl =
      options.WebSocketImpl ??
      (typeof WebSocket === "undefined" ? undefined : (WebSocket as unknown as WebSocketCtor));
    this.maxMessageBytes = options.maxMessageBytes ?? MAX_MESSAGE_BYTES;
    this.clock = options.clock ?? defaultClock;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  }

  connect(): void {
    if (!this.WebSocketImpl || this.socket) return;
    this.closedByUser = false;
    this.open();
  }

  subscribe(topic: string, handler: TopicHandler): () => void {
    let set = this.handlers.get(topic);
    if (!set) this.handlers.set(topic, (set = new Set()));
    set.add(handler);
    this.connect();
    return () => {
      set!.delete(handler);
      if (set!.size === 0 && this.handlers.get(topic) === set) this.handlers.delete(topic);
    };
  }

  /**
   * Error path for rejected frames (oversize, malformed). The frame is
   * dropped and counted either way; listeners are for surfacing it.
   */
  onProtocolError(listener: ProtocolErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  getDiagnostics(): RealtimeDiagnostics {
    return {
      ...this.diagnostics,
      wireStats: this.diagnostics.wireStats && { ...this.diagnostics.wireStats },
    };
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.socket?.close();
    this.socket = null;
  }

  /** Handles one raw inbound frame. Public so non-WebSocket transports can reuse it. */
  handleFrame(data: unknown): void {
    const result = decodeFrame(data, this.maxMessageBytes);
    if (!result.ok) {
      this.reportProtocolError(result.error);
      return;
    }

    this.diagnostics.framesReceived += 1;
    this.diagnostics.bytesReceived += result.bytes;
    const { envelope } = result;

    if (isInternalTopic(envelope.topic)) {
      this.handleInternal(envelope);
      return;
    }
    this.handlers.get(envelope.topic)?.forEach((handler) => {
      try {
        handler(envelope.payload, envelope);
      } catch (err) {
        // One faulty subscriber must not break delivery to the others.
        if (process.env.NODE_ENV !== "production") console.error("[realtime] handler threw", err);
      }
    });
  }

  private open(): void {
    let socket: WebSocket;
    try {
      socket = new this.WebSocketImpl!(this.url, undefined, PERMESSAGE_DEFLATE_OPTIONS);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.binaryType = "arraybuffer";

    socket.addEventListener("open", () => {
      this.attempt = 0;
      const extensions = socket.extensions ?? "";
      this.diagnostics.negotiatedExtensions = extensions;
      // A server that declines compression simply omits it; nothing else changes.
      this.diagnostics.compressionActive = /(^|,)\s*permessage-deflate\b/.test(extensions);
      this.diagnostics.wireStats = null;
      this.startHeartbeat();
    });

    socket.addEventListener("message", (event: MessageEvent) => this.handleFrame(event.data));

    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = null;
      this.stopHeartbeat();
      if (!this.closedByUser) this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      socket.close();
    });
  }

  private handleInternal({ topic, payload }: RealtimeEnvelope): void {
    const p = (payload ?? {}) as Record<string, unknown>;
    if (topic === INTERNAL_TOPICS.PONG) {
      if (typeof p.t0 === "number" && typeof p.serverTs === "number") {
        this.clock.addSample(p.t0, p.serverTs, Date.now());
      }
    } else if (topic === INTERNAL_TOPICS.WIRE_STATS) {
      if (typeof p.compressedBytes === "number" && typeof p.uncompressedBytes === "number") {
        this.diagnostics.wireStats = {
          compressedBytes: p.compressedBytes,
          uncompressedBytes: p.uncompressedBytes,
        };
      }
    }
  }

  private reportProtocolError(error: RealtimeProtocolError): void {
    if (error.code === "oversize") this.diagnostics.oversizeDrops += 1;
    else this.diagnostics.malformedDrops += 1;
    this.diagnostics.lastError = { code: error.code, message: error.message, at: Date.now() };
    if (process.env.NODE_ENV !== "production")
      console.warn(`[realtime] dropped frame: ${error.message}`);
    this.errorListeners.forEach((l) => l(error));
  }

  private sendPing(): void {
    if (!this.socket || this.socket.readyState !== 1 /* OPEN */) return;
    try {
      this.socket.send(
        JSON.stringify({ topic: INTERNAL_TOPICS.PING, payload: { t0: Date.now() } })
      );
    } catch {
      // Best effort: the next heartbeat retries.
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.sendPing();
    this.heartbeatTimer = setInterval(() => this.sendPing(), this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
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
}

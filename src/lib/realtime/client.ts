import { API_BASE_URL } from "../api/client";
import { realtimeBus } from "./bus";
import type { RealtimeTopic, RealtimeTopics } from "./topics";
import { RequestCorrelator, type RequestOptions } from "./correlation";
import { emitRealtimeEvent } from "@/lib/analytics/realtime";
import { readRealtimeOverride, resolveRealtimeConfig } from "./overrides";

type Handler = (payload: unknown) => void;
type ConnectionListener = (state: ConnectionState) => void;

export type ConnectionState = "idle" | "connected" | "reconnecting";

/** The subset of WebSocket the client relies on; fakes implement the same shape. */
export interface RealtimeTransport {
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: { data?: unknown }) => void): void;
  send(data: string): void;
  close(): void;
}

export type TransportFactory = (url: string) => RealtimeTransport;

const defaultTransportFactory: TransportFactory = (url) => new WebSocket(url) as unknown as RealtimeTransport;
let transportFactory: TransportFactory = defaultTransportFactory;
let customTransport = false;

/** Test-only: inject a transport factory. Pass `null` to restore the WebSocket default. */
export function __setTransportFactory(factory: TransportFactory | null): void {
  transportFactory = factory ?? defaultTransportFactory;
  customTransport = factory !== null;
}

export type DecodeErrorCode = "invalid-frame" | "frame-too-large" | "too-deep" | "invalid-message";
export class RealtimeDecodeError extends Error {
  constructor(public readonly code: DecodeErrorCode) {
    super(`Realtime decode failed: ${code}`);
    this.name = "RealtimeDecodeError";
  }
}
export type DecodedRealtimeMessage = { topic: string; payload: unknown; sequence?: number };
export const MAX_REALTIME_FRAME_BYTES = 256 * 1024;
export const MAX_REALTIME_NESTING_DEPTH = 32;

function nestingDepth(text: string): number {
  let depth = 0,
    max = 0,
    quoted = false,
    escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{" || char === "[") {
      depth++;
      max = Math.max(max, depth);
    } else if (char === "}" || char === "]") depth--;
    if (max > MAX_REALTIME_NESTING_DEPTH) return max;
  }
  return max;
}

/** Pure, bounded wire decoder. It never exposes the input as an object prototype. */
export function decodeRealtimeFrame(frame: unknown): DecodedRealtimeMessage {
  let text: string;
  if (typeof frame === "string") text = frame;
  else if (frame instanceof ArrayBuffer) {
    if (frame.byteLength > MAX_REALTIME_FRAME_BYTES)
      throw new RealtimeDecodeError("frame-too-large");
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(frame);
    } catch {
      throw new RealtimeDecodeError("invalid-frame");
    }
  } else if (ArrayBuffer.isView(frame)) {
    if (frame.byteLength > MAX_REALTIME_FRAME_BYTES)
      throw new RealtimeDecodeError("frame-too-large");
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(frame);
    } catch {
      throw new RealtimeDecodeError("invalid-frame");
    }
  } else throw new RealtimeDecodeError("invalid-frame");
  if (new TextEncoder().encode(text).byteLength > MAX_REALTIME_FRAME_BYTES)
    throw new RealtimeDecodeError("frame-too-large");
  if (nestingDepth(text) > MAX_REALTIME_NESTING_DEPTH) throw new RealtimeDecodeError("too-deep");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RealtimeDecodeError("invalid-frame");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new RealtimeDecodeError("invalid-message");
  const value = parsed as Record<string, unknown>;
  if (
    typeof value.topic !== "string" ||
    !/^[a-z][a-z0-9_.:-]{0,127}$/i.test(value.topic) ||
    !Object.hasOwn(value, "payload")
  )
    throw new RealtimeDecodeError("invalid-message");
  return {
    topic: value.topic,
    payload: value.payload,
    ...(Number.isSafeInteger(value.sequence) ? { sequence: value.sequence as number } : {}),
  };
}

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private source: EventSource | null = null;
  private handlers = new Map<string, Map<Handler, number>>();
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const FALLBACK_POLL_MS = 15_000;

/**
 * A small reconnecting WebSocket wrapper exposing a subscribe-by-topic API.
 * The backend contract this assumes (documented, not yet implemented
 * upstream): connect to `${wsUrl}`, receive JSON messages shaped
 * `{ topic: string, payload: unknown }`, one topic per push-based update
 * type (e.g. "oracle_update"). Callers must treat this connection as
 * best-effort — always keep an independent REST fetch as the source of
 * truth for initial state.
 */
export class RealtimeClient {
  private socket: RealtimeTransport | null = null;
  private source: EventSource | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private attempt = 0;
  private closedByUser = false;
  private correlator = new RequestCorrelator();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private teardownTicket = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private activeTransport: RealtimeTransport | "rest" | "off" | null = null;
  private opening = false;
  private lastSequenceByTopic = new Map<string, number>();
  private fallbackActive = false;
  private wireTopics = new Set<string>();
  private listeners = new Set<ConnectionListener>();
  private state: ConnectionState = "idle";

  getConnectionState(): ConnectionState {
    return this.state;
  }

  onConnectionChange(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.listeners.forEach((l) => l(next));
  }

  /**
   * Applies the wire-level topic set as a diff (subscribe/unsubscribe deltas).
   * The full set is re-sent on every (re)connect so a tier change or a
   * reconnect never loses a topic.
   */
  syncTopics(topics: ReadonlySet<string>): void {
    const prev = this.wireTopics;
    this.wireTopics = new Set(topics);
    if (this.socket?.readyState !== 1) return;
    for (const t of topics) if (!prev.has(t)) this.send({ action: "subscribe", topic: t });
    for (const t of prev) if (!topics.has(t)) this.send({ action: "unsubscribe", topic: t });
  }

  private send(msg: unknown): void {
    try {
      this.socket?.send(JSON.stringify(msg));
    } catch {
      // Socket closing — the reconnect path re-sends the full topic set.
    }
  }

  private config() {
    const override = readRealtimeOverride();
    return resolveRealtimeConfig(
      {
        enabled: true,
        endpoint: API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1$/, "/ws"),
        transport: "ws",
      },
      override,
      typeof window === "undefined" ? undefined : window.location.hostname
    );
  }

  connect(): void {
    if ((!customTransport && typeof WebSocket === "undefined") || this.socket) return;
    this.closedByUser = false;
    this.open();
  }

  private async open(): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    let remoteKillSwitch = false;
    if (process.env.NODE_ENV === "production") {
      try {
        const response = await fetch("/flags.json", { cache: "no-store" });
        const flags = response.ok
          ? ((await response.json()) as { flags?: Record<string, boolean> })
          : null;
        remoteKillSwitch = flags?.flags?.["realtime-oracle"] !== true;
      } catch {
        remoteKillSwitch = true;
      }
    }
    const baseConfig = this.config();
    const config = resolveRealtimeConfig(
      baseConfig,
      readRealtimeOverride(),
      typeof window === "undefined" ? undefined : window.location.hostname,
      remoteKillSwitch
    );
    this.opening = false;
    if (this.handlers.size === 0) return;
    if (!config.enabled || config.transport === "off") {
      this.activeTransport = "off";
      this.setState("idle");
      emitRealtimeEvent("unavailable", { reason: "killed" });
      return;
    }
    this.closedByUser = false;
    const transport = config.transport;
    const endpoint = config.endpoint;
    if (transport === "rest") {
      this.startPolling(endpoint);
      return;
    }
    this.activeTransport = transport;
    try {
      if (transport === "sse") {
        if (typeof EventSource === "undefined") {
          this.startPolling(endpoint);
          return;
        }
        this.source = new EventSource(endpoint);
        this.source.onopen = () => {
          this.attempt = 0;
          if (this.fallbackActive) {
            this.fallbackActive = false;
            emitRealtimeEvent("fallback_deactivated", { transport: "sse" });
          }
          this.setState("connected");
          emitRealtimeEvent("connected", { transport: "sse" });
        };
        this.source.onmessage = (event) => this.receive(event.data);
        this.source.onerror = () => {
          this.source?.close();
          this.source = null;
          this.scheduleReconnect();
        };
      } else {
        if (typeof WebSocket === "undefined") {
          this.startPolling(endpoint);
          return;
        }
        this.socket = customTransport ? transportFactory(endpoint) : new WebSocket(endpoint);
        this.socket.addEventListener("open", () => {
          this.attempt = 0;
          if (this.fallbackActive) {
            this.fallbackActive = false;
            emitRealtimeEvent("fallback_deactivated", { transport: "ws" });
          }
          this.setState("connected");
          emitRealtimeEvent("connected", { transport: "ws" });
          for (const t of this.wireTopics) this.send({ action: "subscribe", topic: t });
        });
        this.socket.addEventListener("message", (event) => this.receive(event.data));
        this.socket.addEventListener("close", () => {
          this.socket = null;
          this.correlator.rejectAll();
          if (!this.closedByUser) {
            this.setState("reconnecting");
            this.scheduleReconnect();
          } else {
            this.setState("idle");
          }
        });
        this.socket.addEventListener("error", () => this.socket?.close());
      }
    } catch {
      this.scheduleReconnect();
    }
  }

  private receive(frame: unknown): void {
    try {
      const message = decodeRealtimeFrame(frame);
      if (message.sequence !== undefined) {
        const previous = this.lastSequenceByTopic.get(message.topic);
        if (previous !== undefined && message.sequence <= previous) return;
        this.lastSequenceByTopic.set(message.topic, message.sequence);
      }
      this.handlers.get(message.topic)?.forEach((_count, handler) => handler(message.payload));
      if (
        typeof message.topic === "string" &&
        message.payload !== null &&
        typeof message.payload === "object"
      ) {
        realtimeBus.publish(
          message.topic as RealtimeTopic,
          message.payload as RealtimeTopics[RealtimeTopic]
        );
      }
    } catch (error) {
      if (error instanceof RealtimeDecodeError)
        emitRealtimeEvent("subscription_failure", { reason: error.code });
    }
  }

  private startPolling(endpoint: string): void {
    this.activeTransport = "rest";
    this.fallbackActive = true;
    emitRealtimeEvent("fallback_activated", { transport: "rest" });
    const httpEndpoint = endpoint.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
    const poll = async () => {
      for (const topic of this.handlers.keys()) {
        try {
          const response = await fetch(
            `${httpEndpoint.replace(/\/ws$/, "")}/realtime/${encodeURIComponent(topic)}`
          );
          if (response.ok) {
            const payload = await response.json();
            this.handlers.get(topic)?.forEach((_count, handler) => handler(payload));
          }
        } catch {
          /* REST fallback is best effort. */
        }
      }
    };
    void poll();
    this.pollTimer = setInterval(() => void poll(), FALLBACK_POLL_MS);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.attempt++, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.open();
    }, delay);
  }

  subscribe(topic: string, handler: Handler): () => void {
    let listeners = this.handlers.get(topic);
    if (!listeners) {
      listeners = new Map();
      this.handlers.set(topic, listeners);
      emitRealtimeEvent("topic_subscribed", { topic });
    }
    listeners.set(handler, (listeners.get(handler) ?? 0) + 1);
    const ticket = ++this.teardownTicket;
    if (!this.socket && !this.source && !this.pollTimer && !this.reconnectTimer) void this.open();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = this.handlers.get(topic);
      const count = current?.get(handler) ?? 0;
      if (count <= 1) current?.delete(handler);
      else current?.set(handler, count - 1);
      if (current?.size === 0) {
        this.handlers.delete(topic);
        emitRealtimeEvent("topic_unsubscribed", { topic });
      }
      // A microtask lets StrictMode's immediate remount reuse the active connection.
      queueMicrotask(() => {
        if (this.handlers.size === 0 && this.teardownTicket === ticket) this.disconnect();
      });
    };
  }

  /** One-shot request/response over the open socket; rejects if not connected. */
  request<T = unknown>(topic: string, payload?: unknown, options?: RequestOptions): Promise<T> {
    return this.correlator.request<T>(
      (frame) => {
        if (!this.socket) throw new Error("Realtime socket is not connected");
        this.socket.send(frame);
      },
      topic,
      payload,
      options,
    );
  }

  /** Test-only: drop connection, handlers and reconnect state. */
  __reset(): void {
    this.disconnect();
    this.handlers.clear();
    this.attempt = 0;
    this.closedByUser = false;
  }

  disconnect(): void {
    this.closedByUser = true;
    this.correlator.rejectAll();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.reconnectTimer = null;
    this.pollTimer = null;
    this.source?.close();
    this.source = null;
    this.socket?.close();
    this.socket = null;
    this.setState("idle");
  }

  refreshConfiguration(): void {
    this.disconnect();
    if (this.handlers.size > 0) void this.open();
  }

  getStatus() {
    return { transport: this.activeTransport, override: readRealtimeOverride() };
  }
}

export const realtimeClient = new RealtimeClient();

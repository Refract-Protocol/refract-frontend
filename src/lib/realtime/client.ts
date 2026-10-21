import { API_BASE_URL } from "@/lib/api/client";
import { REALTIME_CONTROL_TOPIC, type RealtimeControl, type RealtimeEnvelope } from "./contract";
import { realRealtimeClock, type RealtimeClock } from "./clock";

type Handler = (payload: unknown) => void;
export interface RealtimeClientOptions {
  clock?: RealtimeClock;
  socketFactory?: (url: string) => WebSocket;
  idleTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  onSubscriberError?: (topic: string, error: unknown) => void;
}

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const DEFAULT_IDLE_TIMEOUT_MS = 15_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10_000;

/** Browser WebSocket client. A shell owner may warm it before hooks subscribe;
 * unused warm connections close after an idle window. */
export class RealtimeClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private controlHandlers = new Set<(control: RealtimeControl) => void>();
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectBackoffMs = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatSocket: WebSocket | null = null;
  private maintenanceUntil = 0;
  private readonly intentionallyClosing = new WeakSet<WebSocket>();
  private revokedTopics = new Set<string>();
  private readonly clock: RealtimeClock;
  private readonly socketFactory: (url: string) => WebSocket;
  private readonly idleTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly onSubscriberError?: RealtimeClientOptions["onSubscriberError"];

  constructor(options: RealtimeClientOptions = {}) {
    this.clock = options.clock ?? realRealtimeClock;
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url));
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
    this.onSubscriberError = options.onSubscriberError;
  }

  connect(): void {
    if (typeof window === "undefined" || this.socket) return;
    this.closedByUser = false;
    this.open();
    this.scheduleIdleClose();
  }

  warm(): void {
    this.connect();
  }

  private open(): void {
    if (typeof window === "undefined" || this.socket || this.closedByUser) return;
    const wsUrl = API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1$/, "/ws");
    try {
      this.socket = this.socketFactory(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    const socket = this.socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      if (this.hasSubscribers()) this.startHeartbeat(socket);
    });
    socket.addEventListener("message", (event) => {
      if (this.socket === socket) this.dispatch(event.data);
    });
    socket.addEventListener("close", () => {
      this.stopHeartbeat(socket);
      if (this.socket === socket) this.socket = null;
      if (this.intentionallyClosing.has(socket)) {
        this.intentionallyClosing.delete(socket);
        return;
      }
      if (!this.closedByUser && this.hasSubscribers()) this.scheduleReconnect();
      else if (!this.closedByUser) this.scheduleIdleClose();
    });
    socket.addEventListener("error", () => socket.close());
  }

  private dispatch(data: unknown): void {
    let envelope: RealtimeEnvelope;
    try {
      const parsed: unknown = JSON.parse(String(data));
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof (parsed as RealtimeEnvelope).topic !== "string"
      )
        return;
      envelope = parsed as RealtimeEnvelope;
    } catch {
      return;
    }
    if (envelope.topic === REALTIME_CONTROL_TOPIC) {
      this.dispatchControl(envelope.payload);
      return;
    }
    this.handlers.get(envelope.topic)?.forEach((handler) => {
      try {
        handler(envelope.payload);
      } catch (error) {
        this.onSubscriberError?.(envelope.topic, error);
      }
    });
  }

  private dispatchControl(payload: unknown): void {
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as RealtimeControl).type !== "string"
    )
      return;
    const control = payload as RealtimeControl;
    if (control.type === "ping") {
      this.sendControl({ type: "pong" });
      return;
    }
    if (control.type === "pong") {
      if (this.heartbeatTimeoutTimer) this.clock.clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
      return;
    }
    if (control.type === "revocation") {
      if (typeof control.topic !== "string" || typeof control.reason !== "string") return;
      if (!this.handlers.has(control.topic)) return;
      this.revokedTopics.add(control.topic);
      this.handlers.delete(control.topic);
      this.controlHandlers.forEach((handler) => handler(control));
      if (!this.hasSubscribers()) {
        this.stopHeartbeat();
        this.scheduleIdleClose();
      }
      return;
    }
    if (control.type === "maintenance" || control.type === "drain") {
      if (typeof control.until !== "number" || !Number.isFinite(control.until)) return;
      this.maintenanceUntil = Math.max(this.maintenanceUntil, control.until);
      this.controlHandlers.forEach((handler) => handler(control));
      if (this.reconnectTimer) {
        this.clock.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.scheduleReconnect(false);
      }
      return;
    }
    if (control.type === "drain-complete") {
      this.maintenanceUntil = 0;
      this.controlHandlers.forEach((handler) => handler(control));
      if (this.reconnectTimer) this.clock.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.reconnectBackoffMs = 0;
      this.attempt = 0;
      if (this.socket) {
        const previousSocket = this.socket;
        this.intentionallyClosing.add(previousSocket);
        this.socket = null;
        previousSocket.close();
      }
      if (this.hasSubscribers()) this.open();
      return;
    }
  }

  private scheduleReconnect(advanceBackoff = true): void {
    if (this.reconnectTimer || this.closedByUser || !this.hasSubscribers()) return;
    if (advanceBackoff || this.reconnectBackoffMs === 0) {
      this.reconnectBackoffMs = Math.min(BASE_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS);
      this.attempt += 1;
    }
    const delay = Math.max(this.reconnectBackoffMs, this.maintenanceUntil - this.clock.now());
    this.reconnectTimer = this.clock.setTimeout(
      () => {
        this.reconnectTimer = null;
        this.reconnectBackoffMs = 0;
        if (!this.closedByUser && this.hasSubscribers()) this.open();
      },
      Math.max(0, delay)
    );
  }

  private hasSubscribers(): boolean {
    return [...this.handlers.values()].some((handlers) => handlers.size > 0);
  }

  private startHeartbeat(socket: WebSocket): void {
    if (this.heartbeatSocket === socket && this.heartbeatTimer) return;
    this.stopHeartbeat();
    this.heartbeatSocket = socket;
    this.heartbeatTimer = this.clock.setInterval(() => {
      if (this.socket !== socket || socket.readyState !== 1) return;
      if (this.heartbeatTimeoutTimer) this.clock.clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = this.clock.setTimeout(() => {
        this.heartbeatTimeoutTimer = null;
        if (this.socket === socket) socket.close();
      }, this.heartbeatTimeoutMs);
      this.sendControl({ type: "ping" });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(socket?: WebSocket): void {
    if (socket && this.heartbeatSocket !== socket) return;
    if (this.heartbeatTimer) this.clock.clearInterval(this.heartbeatTimer);
    if (this.heartbeatTimeoutTimer) this.clock.clearTimeout(this.heartbeatTimeoutTimer);
    this.heartbeatTimer = null;
    this.heartbeatTimeoutTimer = null;
    this.heartbeatSocket = null;
  }

  private sendControl(payload: RealtimeControl): void {
    if (this.socket?.readyState !== 1) return;
    this.socket.send(JSON.stringify({ topic: REALTIME_CONTROL_TOPIC, payload }));
  }

  private scheduleIdleClose(): void {
    if (this.hasSubscribers() || this.idleTimer) return;
    this.idleTimer = this.clock.setTimeout(() => {
      this.idleTimer = null;
      if (!this.hasSubscribers()) this.closeSocket();
    }, this.idleTimeoutMs);
  }

  private cancelIdleClose(): void {
    if (this.idleTimer) this.clock.clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private closeSocket(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) this.clock.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectBackoffMs = 0;
    this.stopHeartbeat();
    this.socket?.close();
    this.socket = null;
  }

  subscribe(topic: string, handler: Handler): () => void {
    if (this.revokedTopics.has(topic)) return () => {};
    this.cancelIdleClose();
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler);
    this.connect();
    if (this.socket?.readyState === 1) this.startHeartbeat(this.socket);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const handlers = this.handlers.get(topic);
      handlers?.delete(handler);
      if (handlers?.size === 0) this.handlers.delete(topic);
      if (!this.hasSubscribers()) {
        this.stopHeartbeat();
        this.scheduleIdleClose();
      }
    };
  }

  subscribeControl(handler: (control: RealtimeControl) => void): () => void {
    this.controlHandlers.add(handler);
    return () => this.controlHandlers.delete(handler);
  }

  disconnect(): void {
    this.cancelIdleClose();
    this.closeSocket();
  }
}

export const realtimeClient = new RealtimeClient();

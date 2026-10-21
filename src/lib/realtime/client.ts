import { API_BASE_URL } from "../api/client";
import { isAllowedRealtimeUrl, resolveRealtimeEndpoint } from "./allowlist";
import {
  checkRemoteKillSwitch,
  isRealtimeDisabled,
  startKillSwitchPolling,
  subscribeKillSwitch,
} from "./killSwitch";

type Handler = (payload: unknown) => void;
export class RealtimeEndpointError extends Error {
  readonly code = "REALTIME_ENDPOINT_NOT_ALLOWED";
  constructor(url: string) {
    super(`Realtime endpoint is not allowlisted: ${url}`);
    this.name = "RealtimeEndpointError";
  }
}

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

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
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private removeKillSwitchListener: (() => void) | null = null;
  private suspended = false;
  private opening = false;

  connect(): void {
    if (
      typeof WebSocket === "undefined" ||
      this.socket ||
      this.opening ||
      isRealtimeDisabled() ||
      this.suspended
    )
      return;
    startKillSwitchPolling();
    if (!this.removeKillSwitchListener)
      this.removeKillSwitchListener = subscribeKillSwitch(({ disabled }) => {
        if (disabled) {
          this.handlers.clear();
          this.stopSocket();
        }
      });
    this.closedByUser = false;
    this.open();
  }

  private async open(): Promise<void> {
    if (this.opening || isRealtimeDisabled() || this.suspended) return;
    this.opening = true;
    await checkRemoteKillSwitch();
    this.opening = false;
    if (isRealtimeDisabled() || this.suspended || this.closedByUser || this.socket) return;
    const wsUrl = resolveRealtimeEndpoint(API_BASE_URL).url;
    if (!isAllowedRealtimeUrl(wsUrl)) throw new RealtimeEndpointError(wsUrl);
    try {
      this.socket = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener("open", () => {
      this.attempt = 0;
    });
    this.socket.addEventListener("message", (event) => {
      try {
        const { topic, payload } = JSON.parse(event.data as string) as {
          topic: string;
          payload: unknown;
        };
        this.handlers.get(topic)?.forEach((handler) => handler(payload));
      } catch {
        // Malformed message — ignore, don't crash the connection.
      }
    });
    this.socket.addEventListener("close", () => {
      this.socket = null;
      if (!this.closedByUser && !isRealtimeDisabled() && !this.suspended) this.scheduleReconnect();
    });
    this.socket.addEventListener("error", () => {
      this.socket?.close();
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser && !isRealtimeDisabled() && !this.suspended) this.open();
    }, delay);
  }

  subscribe(topic: string, handler: Handler): () => void {
    if (isRealtimeDisabled()) return () => undefined;
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic)!.add(handler);
    this.connect();

    return () => {
      this.handlers.get(topic)?.delete(handler);
    };
  }

  disconnect(): void {
    this.closedByUser = true;
    this.stopSocket();
  }

  /** Page lifecycle adapter commands; handlers remain registered for resync. */
  suspend(): void {
    this.suspended = true;
    this.stopSocket();
  }
  resume(): void {
    this.suspended = false;
    this.closedByUser = false;
    this.connect();
  }

  private stopSocket(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
  }
}

export const realtimeClient = new RealtimeClient();

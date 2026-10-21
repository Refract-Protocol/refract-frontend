import { API_BASE_URL, ApiError } from "@/lib/api/client";

export type RealtimeState = "connecting" | "live" | "stale" | "auth_failed";
type Handler = (payload: unknown) => void;
type StateHandler = (state: RealtimeState) => void;
type TokenProvider = (wallet: string) => Promise<{ token: string; expiresAt: number }>;

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const REFRESH_SKEW_MS = 30_000;

async function fetchWalletToken(wallet: string) {
  const response = await fetch(`${API_BASE_URL}/realtime/token`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  if (!response.ok) throw new ApiError("Realtime authentication failed", response.status);
  const result = (await response.json()) as { token: string; expiresAt: number };
  if (!result.token || !Number.isFinite(result.expiresAt))
    throw new Error("Invalid realtime token response");
  return result;
}

interface Subscription {
  handlers: Set<Handler>;
  stateHandlers: Set<StateHandler>;
  authenticated: boolean;
  state: RealtimeState;
}

/** Reconnecting topic client. Credentials are only sent in WebSocket frames. */
class RealtimeClient {
  private socket: WebSocket | null = null;
  private subscriptions = new Map<string, Subscription>();
  private attempt = 0;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private authRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private identity: string | null = null;
  private identityGeneration = 0;
  private tokenProvider: TokenProvider = fetchWalletToken;
  private authenticated = false;
  private opening = false;
  private subscribedTopics = new Set<string>();

  setTokenProvider(provider: TokenProvider): void {
    this.tokenProvider = provider;
  }

  setIdentity(wallet: string | null): void {
    if (wallet === this.identity) return;
    this.identity = wallet;
    this.identityGeneration += 1;
    this.clearRefreshTimer();
    if (this.authRetryTimer) clearTimeout(this.authRetryTimer);
    this.authRetryTimer = null;
    this.authenticated = false;
    this.socket?.close(4001, "identity changed");
    this.socket = null;
    for (const [topic, sub] of this.subscriptions) {
      if (sub.authenticated) this.setState(topic, wallet ? "connecting" : "stale");
    }
    if (this.subscriptions.size) this.connect();
  }

  connect(): void {
    if (typeof WebSocket === "undefined" || this.socket || this.opening) return;
    this.closedByUser = false;
    this.open();
  }

  private async open(): Promise<void> {
    if (this.socket || this.opening || this.closedByUser) return;
    this.opening = true;
    const generation = this.identityGeneration;
    const walletIdentity = this.identity;
    const needsAuth = [...this.subscriptions.values()].some(
      (sub) => sub.authenticated && sub.state !== "auth_failed"
    );
    let token: { token: string; expiresAt: number } | null = null;
    if (needsAuth) {
      if (!walletIdentity) {
        this.setAllAuthState("stale");
      } else
        try {
          token = await this.tokenProvider(walletIdentity);
        } catch (error) {
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            this.setAllAuthState("auth_failed");
          } else {
            this.setAllAuthState("stale");
            this.scheduleAuthRetry();
          }
        }
      if (
        token &&
        (token.expiresAt < 10_000_000_000 ? token.expiresAt * 1000 : token.expiresAt) <= Date.now()
      ) {
        token = null;
        this.setAllAuthState("auth_failed");
      }
    }
    if (generation !== this.identityGeneration || walletIdentity !== this.identity) {
      this.opening = false;
      this.open();
      return;
    }
    if (!token && needsAuth && !this.hasPublicTopics()) {
      this.opening = false;
      return;
    }
    if (this.closedByUser) {
      this.opening = false;
      return;
    }
    const wsUrl = API_BASE_URL.replace(/^http/, "ws").replace(/\/api\/v1$/, "/ws");
    try {
      this.socket = new WebSocket(wsUrl);
    } catch {
      this.opening = false;
      this.scheduleReconnect();
      return;
    }
    const socket = this.socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket || generation !== this.identityGeneration) {
        socket.close();
        return;
      }
      this.opening = false;
      this.attempt = 0;
      if (token || !this.hasRetryableAuth()) {
        if (this.authRetryTimer) clearTimeout(this.authRetryTimer);
        this.authRetryTimer = null;
      }
      if (token) {
        socket.send(
          JSON.stringify({ type: "authenticate", wallet: walletIdentity, token: token.token })
        );
        this.scheduleRefresh(token.expiresAt);
      } else this.subscribeActiveTopics();
    });
    socket.addEventListener("message", (event) => this.receive(event.data, socket));
    socket.addEventListener("close", (event) => {
      const wasCurrent = this.socket === socket;
      if (wasCurrent) this.socket = null;
      this.subscribedTopics.clear();
      if (!wasCurrent) return;
      this.authenticated = false;
      this.subscribedTopics.clear();
      this.clearRefreshTimer();
      const authFailure = event.code === 4401 || event.code === 4403;
      for (const [topic, sub] of this.subscriptions) {
        this.setState(topic, authFailure && sub.authenticated ? "auth_failed" : "stale");
      }
      const hasPublicTopics = [...this.subscriptions.values()].some((sub) => !sub.authenticated);
      if (!this.closedByUser && (!authFailure || hasPublicTopics)) this.scheduleReconnect();
    });
    socket.addEventListener("error", () => socket.close());
  }

  private receive(raw: unknown, socket: WebSocket): void {
    try {
      const frame = JSON.parse(raw as string) as {
        type?: string;
        topic?: string;
        payload?: unknown;
        status?: number;
        expiresAt?: number;
      };
      if (frame.type === "authenticated") {
        this.authenticated = true;
        this.subscribeActiveTopics();
      } else if (
        frame.type === "auth_error" ||
        (frame.type === "error" && (frame.status === 401 || frame.status === 403))
      ) {
        this.authenticated = false;
        this.setAllAuthState("auth_failed");
        socket.close(4401, "authentication failed");
      } else if (frame.type === "token_expiring") {
        void this.refreshToken(socket);
      } else if (frame.topic) {
        this.subscriptions.get(frame.topic)?.handlers.forEach((handler) => handler(frame.payload));
      }
    } catch {
      /* malformed frames are ignored */
    }
  }

  private subscribeActiveTopics(): void {
    for (const [topic, sub] of this.subscriptions) {
      if ((!sub.authenticated || this.authenticated) && !this.subscribedTopics.has(topic)) {
        this.socket?.send(JSON.stringify({ type: "subscribe", topic }));
        this.subscribedTopics.add(topic);
        this.setState(topic, "live");
      }
    }
  }

  private async refreshToken(socket: WebSocket): Promise<void> {
    if (!this.identity || socket !== this.socket) return;
    try {
      const token = await this.tokenProvider(this.identity);
      if (socket !== this.socket) return;
      socket.send(
        JSON.stringify({
          type: "authenticate",
          wallet: this.identity,
          token: token.token,
          refresh: true,
        })
      );
      this.scheduleRefresh(token.expiresAt);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        this.setAllAuthState("auth_failed");
        socket.close(4401, "authentication failed");
      } else socket.close();
    }
  }

  private scheduleRefresh(expiresAt: number): void {
    this.clearRefreshTimer();
    const expiryMs = expiresAt < 10_000_000_000 ? expiresAt * 1000 : expiresAt;
    const delay = Math.max(1_000, expiryMs - Date.now() - REFRESH_SKEW_MS);
    this.refreshTimer = setTimeout(() => {
      if (this.socket) void this.refreshToken(this.socket);
    }, delay);
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private scheduleAuthRetry(): void {
    if (this.authRetryTimer || this.closedByUser) return;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.authRetryTimer = setTimeout(() => {
      this.authRetryTimer = null;
      if (!this.identity) return;
      if (this.socket) this.socket.close();
      else this.open();
    }, delay);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closedByUser) return;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    for (const [topic, sub] of this.subscriptions) {
      if (sub.state !== "auth_failed") this.setState(topic, "stale");
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private setState(topic: string, state: RealtimeState): void {
    const sub = this.subscriptions.get(topic);
    if (!sub || sub.state === state) return;
    sub.state = state;
    sub.stateHandlers.forEach((handler) => handler(state));
  }
  private setAllAuthState(state: RealtimeState): void {
    for (const [topic, sub] of this.subscriptions)
      if (sub.authenticated) this.setState(topic, state);
  }

  private hasRetryableAuth(): boolean {
    return [...this.subscriptions.values()].some(
      (sub) => sub.authenticated && sub.state !== "auth_failed"
    );
  }

  private hasPublicTopics(): boolean {
    return [...this.subscriptions.values()].some((sub) => !sub.authenticated);
  }

  subscribe(
    topic: string,
    handler: Handler,
    options: { authenticated?: boolean; onState?: StateHandler } = {}
  ): () => void {
    let sub = this.subscriptions.get(topic);
    if (!sub) {
      sub = {
        handlers: new Set(),
        stateHandlers: new Set(),
        authenticated: options.authenticated ?? false,
        state: "stale",
      };
      this.subscriptions.set(topic, sub);
    }
    const requiresNewAuth = Boolean(options.authenticated) && !sub.authenticated;
    sub.authenticated = sub.authenticated || Boolean(options.authenticated);
    sub.handlers.add(handler);
    if (options.onState) {
      sub.stateHandlers.add(options.onState);
      options.onState(sub.state);
    }
    if (requiresNewAuth && this.socket) {
      this.socket.close(4001, "authentication required");
      this.socket = null;
    }
    this.connect();
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      (!sub.authenticated || this.authenticated) &&
      !this.subscribedTopics.has(topic)
    ) {
      this.socket.send(JSON.stringify({ type: "subscribe", topic }));
      this.subscribedTopics.add(topic);
      this.setState(topic, "live");
    }
    return () => {
      const current = this.subscriptions.get(topic);
      current?.handlers.delete(handler);
      if (options.onState) current?.stateHandlers.delete(options.onState);
      if (current && current.handlers.size === 0) {
        this.socket?.send(JSON.stringify({ type: "unsubscribe", topic }));
        this.subscribedTopics.delete(topic);
        this.subscriptions.delete(topic);
      }
    };
  }

  disconnect(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.authRetryTimer) clearTimeout(this.authRetryTimer);
    this.authRetryTimer = null;
    this.clearRefreshTimer();
    this.socket?.close();
    this.socket = null;
  }
}

export const realtimeClient = new RealtimeClient();

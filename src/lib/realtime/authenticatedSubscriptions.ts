/**
 * Authenticated (wallet-scoped) subscription management for the realtime client.
 *
 * This module keeps the transport wallet-agnostic: token acquisition is injected
 * via an `AuthTokenProvider`, so the client never imports wallet/auth state
 * directly. It is responsible for:
 *
 *  - tracking which topics are scoped to the authenticated wallet
 *  - detecting auth-related failures (close codes / error frames)
 *  - refreshing the token through the injected provider (deduped, loop-guarded)
 *  - replaying the affected subscriptions after a successful refresh
 *  - surfacing a degraded state (and REST fallback) when refresh fails
 */

/** WebSocket close codes that indicate the auth token is no longer valid. */
export const AUTH_CLOSE_CODES: ReadonlySet<number> = new Set([
  4001, // custom: unauthorized
  4003, // custom: forbidden
  4401, // custom: token expired
  4403, // custom: token invalid
]);

/** Error-frame codes that indicate an auth problem mid-stream. */
export const AUTH_ERROR_CODES: ReadonlySet<string> = new Set([
  'unauthorized',
  'forbidden',
  'token_expired',
  'token_invalid',
  'auth_expired',
]);

/**
 * Injected token provider. Implementations live in the wallet/auth layer.
 * Tokens must never be logged by this module.
 */
export interface AuthTokenProvider {
  /** Returns the current token, or null when the wallet is not authenticated. */
  getAuthToken(): Promise<string | null> | string | null;
  /**
   * Requests a fresh token via the existing wallet auth flow.
   * Resolves to null when refresh is not possible (e.g. wallet disconnected).
   */
  refreshAuthToken(): Promise<string | null>;
}

export type AuthSubscriptionState = 'active' | 'refreshing' | 'degraded';

export interface AuthSubscriptionStatus {
  state: AuthSubscriptionState;
  /** Topics currently considered degraded (fail-closed). */
  degradedTopics: string[];
  /** Last error message, if any. Never contains token values. */
  error?: string;
}

export interface AuthenticatedSubscriptionOptions {
  provider: AuthTokenProvider;
  /** Re-subscribes a single topic on the live transport. */
  subscribe: (topic: string, token: string) => void;
  /** Unsubscribes a single topic on the live transport. */
  unsubscribe: (topic: string) => void;
  /** Optional REST fallback invoked when refresh fails for a topic. */
  fallbackToRest?: (topic: string) => void;
  /** Notified whenever the auth subscription status changes. */
  onStatusChange?: (status: AuthSubscriptionStatus) => void;
  /** Max consecutive refresh attempts before entering degraded state. */
  maxRefreshAttempts?: number;
}

const DEFAULT_MAX_REFRESH_ATTEMPTS = 2;

export class AuthenticatedSubscriptions {
  private readonly provider: AuthTokenProvider;
  private readonly subscribeFn: (topic: string, token: string) => void;
  private readonly unsubscribeFn: (topic: string) => void;
  private readonly fallbackToRest?: (topic: string) => void;
  private readonly onStatusChange?: (status: AuthSubscriptionStatus) => void;
  private readonly maxRefreshAttempts: number;

  private readonly topics = new Set<string>();
  private readonly degradedTopics = new Set<string>();
  private state: AuthSubscriptionState = 'active';
  private lastError?: string;

  /** In-flight refresh, shared so concurrent failures dedupe to one refresh. */
  private refreshInFlight: Promise<string | null> | null = null;
  /** Consecutive refresh attempts without a successful resubscribe. */
  private refreshAttempts = 0;

  constructor(options: AuthenticatedSubscriptionOptions) {
    this.provider = options.provider;
    this.subscribeFn = options.subscribe;
    this.unsubscribeFn = options.unsubscribe;
    this.fallbackToRest = options.fallbackToRest;
    this.onStatusChange = options.onStatusChange;
    this.maxRefreshAttempts =
      options.maxRefreshAttempts ?? DEFAULT_MAX_REFRESH_ATTEMPTS;
  }

  /** Registers a wallet-scoped topic and subscribes it with the current token. */
  async addTopic(topic: string): Promise<void> {
    this.topics.add(topic);
    this.degradedTopics.delete(topic);
    const token = await this.provider.getAuthToken();
    if (!token) {
      this.markDegraded(topic, 'no auth token available');
      return;
    }
    this.subscribeFn(topic, token);
    this.emitStatus();
  }

  /** Removes a wallet-scoped topic. */
  removeTopic(topic: string): void {
    if (!this.topics.delete(topic)) return;
    this.degradedTopics.delete(topic);
    this.unsubscribeFn(topic);
    this.emitStatus();
  }

  /** Returns true when the given close code indicates an auth failure. */
  static isAuthCloseCode(code: number): boolean {
    return AUTH_CLOSE_CODES.has(code);
  }

  /** Returns true when the given error frame indicates an auth failure. */
  static isAuthErrorFrame(code: string | undefined): boolean {
    return code !== undefined && AUTH_ERROR_CODES.has(code);
  }

  /**
   * Handles an auth-related close code. Triggers a deduped token refresh and
   * replays all wallet-scoped subscriptions on success.
   */
  async handleAuthClose(code: number): Promise<void> {
    if (!AuthenticatedSubscriptions.isAuthCloseCode(code)) return;
    await this.refreshAndResubscribe();
  }

  /**
   * Handles an auth-related error frame. Triggers a deduped token refresh and
   * replays all wallet-scoped subscriptions on success.
   */
  async handleAuthError(code: string | undefined): Promise<void> {
    if (!AuthenticatedSubscriptions.isAuthErrorFrame(code)) return;
    await this.refreshAndResubscribe();
  }

  /**
   * Refreshes the token (deduped across concurrent callers) and replays the
   * affected subscriptions. Fail-closed: on failure, topics are marked degraded
   * and REST fallback is invoked where available.
   */
  async refreshAndResubscribe(): Promise<void> {
    if (this.topics.size === 0) return;

    // Loop guard: stop retrying once we've exhausted attempts.
    if (this.refreshAttempts >= this.maxRefreshAttempts) {
      this.degradeAll('auth refresh attempts exhausted');
      return;
    }

    this.state = 'refreshing';
    this.emitStatus();

    const token = await this.getSharedRefresh();
    if (!token) {
      this.refreshAttempts += 1;
      this.degradeAll('auth token refresh failed');
      return;
    }

    // Successful refresh: replay every wallet-scoped topic.
    this.refreshAttempts = 0;
    this.degradedTopics.clear();
    this.state = 'active';
    this.lastError = undefined;
    for (const topic of this.topics) {
      this.subscribeFn(topic, token);
    }
    this.emitStatus();
  }

  /** Current status snapshot. */
  getStatus(): AuthSubscriptionStatus {
    return {
      state: this.state,
      degradedTopics: Array.from(this.degradedTopics),
      error: this.lastError,
    };
  }

  /** Clears all tracked topics (e.g. on wallet disconnect). */
  clear(): void {
    for (const topic of this.topics) {
      this.unsubscribeFn(topic);
    }
    this.topics.clear();
    this.degradedTopics.clear();
    this.refreshAttempts = 0;
    this.state = 'active';
    this.lastError = undefined;
    this.emitStatus();
  }

  private getSharedRefresh(): Promise<string | null> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        return await this.provider.refreshAuthToken();
      } catch {
        return null;
      } finally {
        this.refreshInFlight = null;
      }
    })();
    return this.refreshInFlight;
  }

  private degradeAll(reason: string): void {
    this.state = 'degraded';
    this.lastError = reason;
    for (const topic of this.topics) {
      this.degradedTopics.add(topic);
      this.fallbackToRest?.(topic);
    }
    this.emitStatus();
  }

  private markDegraded(topic: string, reason: string): void {
    this.state = 'degraded';
    this.lastError = reason;
    this.degradedTopics.add(topic);
    this.fallbackToRest?.(topic);
    this.emitStatus();
  }

  private emitStatus(): void {
    this.onStatusChange?.(this.getStatus());
  }
}

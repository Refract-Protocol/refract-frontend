/**
 * Shared types for the realtime transport layer.
 */

export type RealtimeConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'degraded'
  | 'closed';

export type RealtimeCloseCode =
  | 1000 // normal closure
  | 1001 // going away
  | 1006 // abnormal closure
  | 4001 // auth expired
  | 4003 // auth forbidden
  | 4401 // unauthorized
  | 4403 // forbidden
  | number;

/**
 * Provider used by the transport to obtain and refresh auth tokens.
 * Kept wallet-agnostic so the transport stays testable and decoupled
 * from any specific wallet/auth implementation.
 */
export interface AuthTokenProvider {
  /** Returns the current auth token, or null if none is available. */
  getAuthToken(): string | null | Promise<string | null>;
  /**
   * Requests a fresh auth token via the existing wallet auth flow.
   * Implementations MUST dedupe concurrent calls and avoid refresh loops.
   * Resolves to the new token, or null if refresh failed.
   */
  refreshAuthToken(): Promise<string | null>;
}

/**
 * A subscription that is scoped to an authenticated wallet and therefore
 * must be replayed after a successful re-authentication.
 */
export interface AuthenticatedSubscription {
  topic: string;
  /** Wallet address the topic is scoped to, if applicable. */
  wallet?: string;
  /** Arbitrary payload replayed on resubscribe. */
  params?: Record<string, unknown>;
}

/**
 * Reasons a realtime connection may enter a degraded state.
 */
export type RealtimeDegradedReason =
  | 'auth-refresh-failed'
  | 'auth-refresh-loop'
  | 'auth-required';

export interface RealtimeDegradedState {
  reason: RealtimeDegradedReason;
  /** Whether the consumer should fall back to REST polling. */
  fallbackToRest: boolean;
  /** Human-readable message safe to surface in the UI (never contains tokens). */
  message: string;
}

export interface RealtimeAuthOptions {
  /** Injected token provider; required for wallet-scoped subscriptions. */
  auth?: AuthTokenProvider;
  /** Max consecutive refresh attempts before entering degraded state. */
  maxRefreshAttempts?: number;
}

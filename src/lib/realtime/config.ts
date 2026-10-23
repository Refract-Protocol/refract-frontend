/**
 * Realtime transport configuration and backoff policy.
 *
 * The backoff policy is intentionally pure and independent of the socket
 * lifecycle so it can be unit-tested deterministically. See issue #224.
 */

export interface BackoffConfig {
  /** Delay for the first retry attempt, in milliseconds. */
  baseDelayMs: number;
  /** Upper bound for any computed delay, in milliseconds. */
  maxDelayMs: number;
  /** Exponential growth factor applied per attempt. */
  factor: number;
  /**
   * Jitter strategy. `full` picks uniformly in [0, delay]; `decorrelated`
   * blends the previous delay with a fresh random value (AWS-style).
   */
  jitter: 'full' | 'decorrelated';
  /**
   * How long a connection must stay open before the backoff budget is reset.
   * Prevents flapping sockets from resetting the budget on every open.
   */
  stabilityThresholdMs: number;
}

export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  factor: 2,
  jitter: 'full',
  stabilityThresholdMs: 10_000,
};

/**
 * Compute the delay before the next reconnect attempt.
 *
 * @param attempt Zero-based attempt counter (0 = first retry).
 * @param config  Backoff policy configuration.
 * @param random  Injectable RNG in [0, 1) for deterministic tests.
 * @param previousDelayMs Previous delay, used by decorrelated jitter.
 * @returns A strictly positive delay in milliseconds, capped at maxDelayMs.
 */
export function computeBackoff(
  attempt: number,
  config: BackoffConfig = DEFAULT_BACKOFF_CONFIG,
  random: () => number = Math.random,
  previousDelayMs?: number,
): number {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const exponential = config.baseDelayMs * Math.pow(config.factor, safeAttempt);
  const capped = Math.min(exponential, config.maxDelayMs);

  let delay: number;
  if (config.jitter === 'decorrelated' && previousDelayMs !== undefined) {
    const upper = Math.min(config.maxDelayMs, previousDelayMs * config.factor);
    delay = config.baseDelayMs + random() * (upper - config.baseDelayMs);
  } else {
    // Full jitter: uniform in [0, capped].
    delay = random() * capped;
  }

  // Jitter must never yield a zero or negative delay.
  return Math.max(1, Math.min(delay, config.maxDelayMs));
}

/**
 * Parse a server-provided retry hint (e.g. `retry-after` header or close
 * reason) into a bounded delay in milliseconds. Returns `undefined` when no
 * usable hint is present.
 */
export function parseRetryAfter(
  value: string | number | null | undefined,
  config: BackoffConfig = DEFAULT_BACKOFF_CONFIG,
): number | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return undefined;
    return Math.min(value, config.maxDelayMs);
  }

  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  // Numeric seconds form.
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, config.maxDelayMs);
  }

  // HTTP-date form.
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    const delta = date - Date.now();
    if (delta > 0) return Math.min(delta, config.maxDelayMs);
  }

  return undefined;
}

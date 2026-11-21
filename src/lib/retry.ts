/**
 * Retry helper with exponential backoff and jitter.
 *
 * Only transient failures are retried: network errors, timeouts, 5xx responses
 * and 429 (rate limited). Other 4xx responses fail fast. This mirrors the
 * retry policy documented in `docs/realtime-operations.md`.
 */

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Override the default retryability classification. */
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_MAX_DELAY_MS = 5_000;

const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

const RETRYABLE_NAMES = new Set([
  'TimeoutError',
  'AbortError',
  'NetworkError',
  'FetchError',
]);

function readStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const record = error as Record<string, unknown>;
  const candidates = [record.status, record.statusCode, record.response];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === 'object' && candidate !== null) {
      const nested = (candidate as Record<string, unknown>).status;
      if (typeof nested === 'number' && Number.isFinite(nested)) return nested;
    }
  }
  return undefined;
}

/**
 * Returns true when the thrown value represents a transient failure that is
 * worth retrying. Non-retryable 4xx responses (400, 401, 403, 404, ...) return
 * false so callers fail fast.
 */
export function isRetryableError(error: unknown): boolean {
  const status = readStatus(error);
  if (status !== undefined) {
    if (status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    if (status >= 400 && status <= 499) return false;
  }

  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.code === 'string' && RETRYABLE_CODES.has(record.code)) return true;
    if (typeof record.name === 'string' && RETRYABLE_NAMES.has(record.name)) return true;
  }

  // Unknown failures (e.g. a bare network rejection) are treated as transient.
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(exponential * (0.5 + Math.random() * 0.5));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const shouldRetry = options.shouldRetry ?? isRetryableError;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      await delay(backoffDelay(attempt, baseDelayMs, maxDelayMs));
      attempt += 1;
    }
  }
}

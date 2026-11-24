export interface RetryOptions {
  /** Extra attempts after the first one. */
  retries: number;
  /** Delay before the first retry; doubles on each subsequent one. */
  baseDelayMs: number;
  /** Only errors this returns true for are retried; anything else is rethrown immediately. */
  isRetryable: (err: unknown) => boolean;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Called once when retries are exhausted (or a non-retryable error is thrown). */
  onExhausted?: (err: unknown) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `fn`, retrying retryable failures with exponential backoff up to `retries` times. */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  { retries, baseDelayMs, isRetryable, sleep = defaultSleep, onExhausted }: RetryOptions
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) {
        onExhausted?.(err);
        throw err;
      }
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
}

import { ApiUnreachableError } from "@/lib/api/client";

/** What every fixture-backed read hook's query resolves to. */
export interface FixtureResult<T> {
  data: T | null;
  /** True when `data` is the labeled local fixture rather than a real API response. */
  isFixture: boolean;
  error: string | null;
}

interface FallbackOptions<T> {
  /** Request cancellation signal from TanStack Query's queryFn context. */
  signal?: AbortSignal;
  /** Fall back on any failure (informational cards) instead of only when the API is unreachable. */
  fallbackOnAnyError?: boolean;
  /** Also use the fixture for a successful-but-empty response (e.g. zero policies after a backend restart). */
  isEmpty?: (data: T) => boolean;
  /** Message surfaced when a non-fallback error has no message of its own. */
  errorMessage?: string;
}

/**
 * The single fetch → fixture-fallback rule every read hook used to hand-roll:
 * resolve to real data, fall back to the labeled fixture when the API is
 * unreachable (or on any error / empty result, when asked to), otherwise
 * surface the error as a message. Never rejects except on cancellation, so
 * TanStack Query can still discard aborted requests.
 */
export async function queryFnWithFixtureFallback<T>(
  fetcher: () => Promise<T>,
  fixture: () => T,
  { signal, fallbackOnAnyError = false, isEmpty, errorMessage = "Failed to load data" }: FallbackOptions<T> = {}
): Promise<FixtureResult<T>> {
  try {
    const data = await fetcher();
    if (isEmpty?.(data)) return { data: fixture(), isFixture: true, error: null };
    return { data, isFixture: false, error: null };
  } catch (err) {
    if (signal?.aborted) throw err;
    if (fallbackOnAnyError || err instanceof ApiUnreachableError) {
      return { data: fixture(), isFixture: true, error: null };
    }
    return { data: null, isFixture: false, error: err instanceof Error ? err.message : errorMessage };
  }
}

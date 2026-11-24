import { useCallback, useEffect, useRef, useState } from 'react';

export interface UsePollingOptions {
  /** Interval between polls in milliseconds. */
  intervalMs?: number;
  /** Whether polling is enabled. Defaults to true. */
  enabled?: boolean;
  /** Run the polled function immediately on mount. Defaults to true. */
  immediate?: boolean;
}

export interface UsePollingResult<T> {
  data: T | undefined;
  error: Error | undefined;
  isLoading: boolean;
  isError: boolean;
  refresh: () => Promise<void>;
}

const DEFAULT_INTERVAL_MS = 15_000;

/**
 * Polls an async function on a fixed cadence, exposing the latest data and any
 * error from the most recent poll. Errors are captured into state so callers
 * can surface failures and back off; a successful poll clears the error.
 */
export function usePolling<T>(
  fn: () => Promise<T>,
  options: UsePollingOptions = {},
): UsePollingResult<T> {
  const { intervalMs = DEFAULT_INTERVAL_MS, enabled = true, immediate = true } = options;

  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(enabled && immediate);

  const fnRef = useRef(fn);
  fnRef.current = fn;

  const mountedRef = useRef(true);

  const runPoll = useCallback(async () => {
    try {
      const result = await fnRef.current();
      if (!mountedRef.current) return;
      setData(result);
      setError(undefined);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    if (immediate) {
      setIsLoading(true);
      void runPoll();
    }

    const id = setInterval(() => {
      void runPoll();
    }, intervalMs);

    return () => {
      clearInterval(id);
    };
  }, [enabled, immediate, intervalMs, runPoll]);

  return {
    data,
    error,
    isLoading,
    isError: error !== undefined,
    refresh: runPoll,
  };
}

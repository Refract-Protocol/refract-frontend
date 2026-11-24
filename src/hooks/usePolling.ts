import { useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/nextjs";

interface UsePollingOptions {
  intervalMs?: number;
  enabled?: boolean;
}

interface UsePollingResult<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
}

const DEFAULT_INTERVAL_MS = 15_000;

export function usePolling<T>(
  fn: () => Promise<T>,
  options: UsePollingOptions = {},
): UsePollingResult<T> {
  const { intervalMs = DEFAULT_INTERVAL_MS, enabled = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);

  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      try {
        const result = await fnRef.current();
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        const normalized = err instanceof Error ? err : new Error(String(err));
        setError(normalized);
        // Report only after the poll cycle has failed; retries are handled
        // upstream by src/lib/retry.ts, so this fires once per exhausted cycle.
        Sentry.captureException(normalized);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          timer = setTimeout(run, intervalMs);
        }
      }
    };

    setIsLoading(true);
    void run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, intervalMs]);

  return { data, error, isLoading };
}

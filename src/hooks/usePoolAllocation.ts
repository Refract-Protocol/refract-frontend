'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ApiUnreachableError,
  fetchPoolAllocation,
  type PoolAllocation,
} from '@/lib/api/pool';
import { FIXTURE_POOL_ALLOCATION } from '@/lib/fixtures/poolStats';

/**
 * Per-coverage-type pool exposure for the Capital Allocation card.
 *
 * Mirrors `usePoolStats`: only an `ApiUnreachableError` falls back to the
 * labelled fixture. Any other failure surfaces as an error so we never
 * silently render invented numbers as if they were the pool's real book.
 */
export interface UsePoolAllocationResult {
  allocation: PoolAllocation | null;
  isLoading: boolean;
  error: Error | null;
  /** True when the returned data is the labelled fixture, not live data. */
  isFixture: boolean;
  refetch: () => void;
}

export function usePoolAllocation(): UsePoolAllocationResult {
  const [allocation, setAllocation] = useState<PoolAllocation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isFixture, setIsFixture] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const refetch = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const data = await fetchPoolAllocation();
        if (cancelled) return;
        setAllocation(data);
        setIsFixture(false);
      } catch (err) {
        if (cancelled) return;

        if (err instanceof ApiUnreachableError) {
          setAllocation(FIXTURE_POOL_ALLOCATION);
          setIsFixture(true);
        } else {
          setAllocation(null);
          setIsFixture(false);
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return { allocation, isLoading, error, isFixture, refetch };
}

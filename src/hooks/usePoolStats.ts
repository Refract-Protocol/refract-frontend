"use client";

import { useEffect, useState } from "react";
import { fetchPoolStats, type PoolStats } from "@/lib/api/pool";
import { FIXTURE_POOL_STATS } from "@/lib/fixtures/poolStats";
import { ApiUnreachableError } from "@/lib/api/client";

interface PoolStatsState {
  data: PoolStats | null;
  loading: boolean;
  error: string | null;
  isFixture: boolean;
}

/** Loads pool-wide stats from GET /api/v1/pool/stats, falling back to the bundled fixture offline. */
export function usePoolStats(): PoolStatsState {
  const [state, setState] = useState<PoolStatsState>({ data: null, loading: true, error: null, isFixture: false });

  useEffect(() => {
    const controller = new AbortController();
    fetchPoolStats(controller.signal)
      .then((data) => setState({ data, loading: false, error: null, isFixture: false }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiUnreachableError) {
          setState({ data: FIXTURE_POOL_STATS, loading: false, error: null, isFixture: true });
          return;
        }
        setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Failed to load pool stats", isFixture: false });
      });
    return () => controller.abort();
  }, []);

  return state;
}

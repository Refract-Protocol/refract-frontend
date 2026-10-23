"use client";

import { useCallback, useState } from "react";
import { ApiUnreachableError } from "@/lib/api/client";
import { fetchPoolStats, type PoolStats } from "@/lib/api/pool";
import { FIXTURE_POOL_STATS } from "@/lib/fixtures/poolStats";
import { readPoolStats } from "@/lib/stellar/rpc";
import type { DataSource } from "@/lib/api/dataSource";
import { usePolling } from "./usePolling";

export const POOL_STATS_POLL_INTERVAL_MS = 60_000;

interface PoolStatsState {
  data: PoolStats | null;
  loading: boolean;
  error: string | null;
  isFixture: boolean;
  dataSource: DataSource | null;
}

export function usePoolStats(): PoolStatsState {
  const [state, setState] = useState<PoolStatsState>({
    data: null,
    loading: true,
    error: null,
    isFixture: false,
    dataSource: null,
  });
  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const data = await fetchPoolStats(signal);
      if (!signal.aborted)
        setState({ data, loading: false, error: null, isFixture: false, dataSource: "api" });
    } catch (error) {
      if (signal.aborted) return;
      if (!(error instanceof ApiUnreachableError)) {
        setState({
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load pool stats",
          isFixture: false,
          dataSource: null,
        });
        return;
      }
      try {
        const data = await readPoolStats(signal);
        if (!signal.aborted)
          setState({ data, loading: false, error: null, isFixture: false, dataSource: "chain" });
      } catch {
        if (!signal.aborted)
          setState({
            data: FIXTURE_POOL_STATS,
            loading: false,
            error: null,
            isFixture: true,
            dataSource: "fixture",
          });
      }
    }
  }, []);
  usePolling(load, POOL_STATS_POLL_INTERVAL_MS);
  return state;
}

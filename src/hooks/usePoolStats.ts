"use client";
import { useCallback, useState } from "react";
import { fetchPoolStats, type PoolStats } from "@/lib/api/pool";
import { ApiUnreachableError } from "@/lib/api/client";
import { readPoolStats } from "@/lib/stellar/rpc";
import { FIXTURE_POOL_STATS } from "@/lib/fixtures/poolStats";
import { useRealtimeTopic } from "./useRealtimeTopic";

export function usePoolStats() {
  const [dataSource, setDataSource] = useState<"api" | "chain" | "fixture" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (signal: AbortSignal): Promise<PoolStats> => {
    try {
      const result = await fetchPoolStats(signal);
      setDataSource("api"); setError(null); return result;
    } catch (apiError) {
      if (!(apiError instanceof ApiUnreachableError)) {
        setDataSource(null); setError(apiError instanceof Error ? apiError.message : "Failed to load pool stats");
        throw apiError;
      }
      try { const result = await readPoolStats(); setDataSource("chain"); setError(null); return result; }
      catch { setDataSource("fixture"); setError(null); return FIXTURE_POOL_STATS; }
    }
  }, []);
  const { data, isLoading, isStale } = useRealtimeTopic<PoolStats>("pool_stats", load);
  return { data, loading: isLoading, error, dataSource, isFixture: dataSource === "fixture", isStale };
}

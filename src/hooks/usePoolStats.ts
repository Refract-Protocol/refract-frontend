"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchPoolStats, type PoolStats } from "@/lib/api/pool";
import type { DataSource } from "@/lib/api/dataSource";
import { ApiUnreachableError } from "@/lib/api/client";
import { FIXTURE_POOL_STATS } from "@/lib/fixtures/poolStats";
import { readPoolStats } from "@/lib/stellar/rpc";

interface PoolStatsState {
  data: PoolStats | null;
  loading: boolean;
  error: string | null;
  isFixture: boolean;
  dataSource: DataSource | null;
}

interface PoolStatsResult {
  data: PoolStats | null;
  dataSource: DataSource | null;
  error: string | null;
}

async function loadPoolStats(signal: AbortSignal): Promise<PoolStatsResult> {
  try {
    return { data: await fetchPoolStats(), dataSource: "api", error: null };
  } catch (err) {
    if (signal.aborted) throw err;
    if (!(err instanceof ApiUnreachableError)) {
      return {
        data: null,
        dataSource: null,
        error: err instanceof Error ? err.message : "Failed to load pool stats",
      };
    }
  }
  try {
    return { data: await readPoolStats(signal), dataSource: "chain", error: null };
  } catch {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return { data: FIXTURE_POOL_STATS, dataSource: "fixture", error: null };
  }
}

/**
 * Loads pool-wide stats: API first, then a direct on-chain read, then the
 * bundled fixture. The query key is shared, so every component (landing,
 * /provide) reuses one cached request within the QueryClient's staleTime.
 */
export function usePoolStats(): PoolStatsState {
  const { data: result, isLoading } = useQuery({
    queryKey: ["poolStats"],
    queryFn: ({ signal }) => loadPoolStats(signal),
  });

  return {
    data: result?.data ?? null,
    loading: isLoading,
    error: result?.error ?? null,
    isFixture: result?.dataSource === "fixture",
    dataSource: result?.dataSource ?? null,
  };
}

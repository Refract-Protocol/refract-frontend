"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchPoolStats, type PoolStats } from "@/lib/api/pool";
import { FIXTURE_POOL_STATS } from "@/lib/fixtures/poolStats";
import { queryFnWithFixtureFallback } from "@/lib/query/fixtureFallback";

interface PoolStatsState {
  data: PoolStats | null;
  loading: boolean;
  error: string | null;
  isFixture: boolean;
}

/** Loads pool-wide stats from GET /api/v1/pool/stats, falling back to the bundled fixture offline. */
export function usePoolStats(): PoolStatsState {
  const { data: result, isLoading } = useQuery({
    queryKey: ["poolStats"],
    queryFn: ({ signal }) =>
      queryFnWithFixtureFallback(() => fetchPoolStats(signal), () => FIXTURE_POOL_STATS, {
        signal,
        errorMessage: "Failed to load pool stats",
      }),
  });

  return { data: result?.data ?? null, loading: isLoading, error: result?.error ?? null, isFixture: result?.isFixture ?? false };
}

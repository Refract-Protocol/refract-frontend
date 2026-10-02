"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchClaimStats, type ClaimStats } from "@/lib/api/claims";
import { FIXTURE_CLAIM_STATS } from "@/lib/fixtures/claimStats";
import { queryFnWithFixtureFallback } from "@/lib/query/fixtureFallback";

interface ClaimStatsState {
  data: ClaimStats | null;
  loading: boolean;
  isFixture: boolean;
}

/** Loads protocol-wide claim stats from GET /api/v1/claims/stats, falling back to the bundled fixture offline. */
export function useClaimStats(): ClaimStatsState {
  const { data: result, isLoading } = useQuery({
    queryKey: ["claimStats"],
    queryFn: ({ signal }) =>
      queryFnWithFixtureFallback(() => fetchClaimStats(signal), () => FIXTURE_CLAIM_STATS, {
        signal,
        fallbackOnAnyError: true,
      }),
  });

  return { data: result?.data ?? null, loading: isLoading, isFixture: result?.isFixture ?? false };
}

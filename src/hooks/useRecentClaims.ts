"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchRecentClaims, type ClaimRecord } from "@/lib/api/claims";
import { FIXTURE_RECENT_CLAIMS } from "@/lib/fixtures/recentClaims";
import { queryFnWithFixtureFallback } from "@/lib/query/fixtureFallback";

interface RecentClaimsState {
  data: ClaimRecord[] | null;
  loading: boolean;
  isFixture: boolean;
}

/**
 * Loads recent settlement activity from GET /api/v1/claims/recent for
 * public "recent payouts" displays. Falls back to a labeled fixture both
 * when the API is unreachable AND when it legitimately returns zero
 * claims (a fresh deployment has none yet), same convention as the other
 * data hooks in this app.
 */
export function useRecentClaims(): RecentClaimsState {
  const { data: result, isLoading } = useQuery({
    queryKey: ["recentClaims"],
    queryFn: ({ signal }) =>
      queryFnWithFixtureFallback(
        async () => (await fetchRecentClaims(signal)).claims,
        () => FIXTURE_RECENT_CLAIMS,
        { signal, fallbackOnAnyError: true, isEmpty: (claims) => claims.length === 0 }
      ),
  });

  return { data: result?.data ?? null, loading: isLoading, isFixture: result?.isFixture ?? false };
}

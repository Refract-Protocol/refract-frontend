"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchRecentClaims, type ClaimRecord } from "@/lib/api/claims";
import { FIXTURE_RECENT_CLAIMS } from "@/lib/fixtures/recentClaims";
import { queryFnWithFixtureFallback, type FixtureResult } from "@/lib/query/fixtureFallback";
import { useAdaptivePolling } from "./useAdaptivePolling";
import { useRealtimeTopic } from "./useRealtimeTopic";

interface RecentClaimsState {
  data: ClaimRecord[] | null;
  loading: boolean;
  isFixture: boolean;
}

const QUERY_KEY = ["recentClaims"] as const;
const MAX_RECENT = 20;

const sameClaim = (a: ClaimRecord, b: ClaimRecord) =>
  a.policyId === b.policyId && a.processedAt === b.processedAt;

/** Newest first, deduplicated, capped. */
export function prependClaim(
  claims: ClaimRecord[],
  next: ClaimRecord,
  max = MAX_RECENT
): ClaimRecord[] {
  return [next, ...claims.filter((c) => !sameClaim(c, next))].slice(0, max);
}

/**
 * Loads recent settlement activity from GET /api/v1/claims/recent for public
 * "recent payouts" displays, prepends `claim_settled` realtime frames, and
 * polls at a cadence set by realtime health (standard tier). Falls back to a
 * labeled fixture when the API is unreachable or returns zero claims.
 */
export function useRecentClaims(): RecentClaimsState {
  const queryClient = useQueryClient();
  const refetchInterval = useAdaptivePolling({
    topic: "claim_settled",
    tier: "standard",
    queryKey: QUERY_KEY,
  });

  const { data: result, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) =>
      queryFnWithFixtureFallback(
        async () => (await fetchRecentClaims({}, signal)).items,
        () => FIXTURE_RECENT_CLAIMS,
        { signal, fallbackOnAnyError: true, isEmpty: (claims) => claims.length === 0 }
      ),
    refetchInterval,
  });

  useRealtimeTopic("claim_settled", (claim) => {
    queryClient.setQueryData<FixtureResult<ClaimRecord[]>>(QUERY_KEY, (prev) => {
      if (!prev) return prev;
      // A real settlement replaces fixture rows rather than mixing with them.
      const base = prev.isFixture || !prev.data ? [] : prev.data;
      return { data: prependClaim(base, claim), isFixture: false, error: null };
    });
  });

  return { data: result?.data ?? null, loading: isLoading, isFixture: result?.isFixture ?? false };
}

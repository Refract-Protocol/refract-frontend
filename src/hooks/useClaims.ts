"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Policy } from "@/lib/api/policies";
import { fetchHolderClaims, type ClaimRecord } from "@/lib/api/claims";
import { fixtureClaimsForHolder } from "@/lib/fixtures/claims";
import { useAdaptivePolling } from "./useAdaptivePolling";
import { useRealtimeTopic } from "./useRealtimeTopic";
import { prependClaim } from "./useRecentClaims";

const NO_CLAIMS: ClaimRecord[] = [];

/**
 * Loads a wallet's claim history from GET /api/v1/claims/holder/:address,
 * merges `holder_claim` realtime frames for that same wallet, and polls at a
 * cadence set by realtime health (critical tier).
 *
 * Mirrors useHolderPolicies: the backend's in-memory history is empty on
 * every process restart, so this falls back to the labeled fixture both when
 * the API is unreachable AND when it legitimately returns zero claims.
 */
export function useClaims(address: string | null, policies: Policy[] | null): ClaimRecord[] {
  const queryClient = useQueryClient();
  const enabled = Boolean(address && policies);
  const queryKey = useMemo(() => ["holderClaims", address] as const, [address]);
  const refetchInterval = useAdaptivePolling({ topic: "holder_claim", tier: "critical", queryKey });

  // Resolves to null on any failure; the fixture is derived below because it
  // depends on `policies`, which isn't part of the cache key.
  const { data: fetched } = useQuery({
    queryKey,
    enabled,
    queryFn: async ({ signal }) => {
      try {
        return (await fetchHolderClaims(address!, {}, signal)).items;
      } catch (err) {
        if (signal.aborted) throw err;
        return null;
      }
    },
    refetchInterval: enabled ? refetchInterval : false,
  });

  // Only frames for *this* account and the current scope epoch get here (see useRealtimeTopic).
  useRealtimeTopic(
    "holder_claim",
    (claim) => {
      if (claim.holder !== address) return;
      queryClient.setQueryData<ClaimRecord[] | null>(queryKey, (prev) =>
        prependClaim(prev ?? [], claim, Infinity)
      );
    },
    { enabled: Boolean(address), account: address }
  );

  return useMemo(() => {
    if (!enabled || fetched === undefined) return NO_CLAIMS;
    return fetched && fetched.length > 0 ? fetched : fixtureClaimsForHolder(address!, policies!);
  }, [enabled, fetched, address, policies]);
}

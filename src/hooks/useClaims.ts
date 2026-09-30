"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Policy } from "@/lib/api/policies";
import { fetchHolderClaims, type ClaimRecord } from "@/lib/api/claims";
import { fixtureClaimsForHolder } from "@/lib/fixtures/claims";

const NO_CLAIMS: ClaimRecord[] = [];

/**
 * Loads a wallet's claim history from GET /api/v1/claims/holder/:address.
 * Mirrors useHolderPolicies: the backend's in-memory history is empty on
 * every process restart, so this falls back to the labeled fixture both
 * when the API is unreachable AND when it legitimately returns zero claims,
 * so the dashboard has something to demo.
 */
export function useClaims(address: string | null, policies: Policy[] | null): ClaimRecord[] {
  const enabled = Boolean(address && policies);
  // Resolves to null on any failure; the fixture is derived below because it
  // depends on `policies`, which isn't part of the cache key.
  const { data: fetched } = useQuery({
    queryKey: ["holderClaims", address],
    enabled,
    queryFn: async ({ signal }) => {
      try {
        return (await fetchHolderClaims(address!, signal)).claims;
      } catch (err) {
        if (signal.aborted) throw err;
        return null;
      }
    },
  });

  return useMemo(() => {
    if (!enabled || fetched === undefined) return NO_CLAIMS;
    return fetched && fetched.length > 0 ? fetched : fixtureClaimsForHolder(address!, policies!);
  }, [enabled, fetched, address, policies]);
}

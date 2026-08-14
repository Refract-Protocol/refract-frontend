"use client";

import { useEffect, useState } from "react";
import type { Policy } from "@/lib/api/policies";
import { fetchHolderClaims, type ClaimRecord } from "@/lib/api/claims";
import { fixtureClaimsForHolder } from "@/lib/fixtures/claims";

/**
 * Loads a wallet's claim history from GET /api/v1/claims/holder/:address.
 * Mirrors useHolderPolicies: the backend's in-memory history is empty on
 * every process restart, so this falls back to the labeled fixture both
 * when the API is unreachable AND when it legitimately returns zero claims,
 * so the dashboard has something to demo.
 */
export function useClaims(address: string | null, policies: Policy[] | null): ClaimRecord[] {
  const [claims, setClaims] = useState<ClaimRecord[]>([]);

  useEffect(() => {
    if (!address || !policies) {
      setClaims([]);
      return;
    }
    const controller = new AbortController();

    fetchHolderClaims(address, controller.signal)
      .then(({ claims: fetched }) => {
        setClaims(fetched.length > 0 ? fetched : fixtureClaimsForHolder(address, policies));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setClaims(fixtureClaimsForHolder(address, policies));
      });

    return () => controller.abort();
  }, [address, policies]);

  return claims;
}

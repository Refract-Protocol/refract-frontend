"use client";

import { useEffect, useState } from "react";
import type { Policy } from "@/lib/api/policies";
import { fetchHolderClaims, type ClaimRecord } from "@/lib/api/claims";
import { fixtureClaimsForHolder } from "@/lib/fixtures/claims";
import { cacheGet, cacheSet, walletCacheKey } from "@/lib/cache/indexedDb";

const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60_000;

/**
 * Loads a wallet's claim history from GET /api/v1/claims/holder/:address.
 * Mirrors useHolderPolicies: the backend's in-memory history is empty on
 * every process restart, so this falls back to the labeled fixture both
 * when the API is unreachable AND when it legitimately returns zero claims,
 * so the dashboard has something to demo.
 *
 * Stale-while-revalidate: the last real claim list is cached in IndexedDB
 * per wallet address and shown immediately, then replaced by the fresh fetch.
 */
export function useClaims(address: string | null, policies: Policy[] | null): ClaimRecord[] {
  const [claims, setClaims] = useState<ClaimRecord[]>([]);

  useEffect(() => {
    if (!address || !policies) {
      setClaims([]);
      return;
    }
    const controller = new AbortController();
    const cacheKey = walletCacheKey(address, "claims");
    let settled = false;
    setClaims([]);

    cacheGet<ClaimRecord[]>(cacheKey, MAX_CACHE_AGE_MS).then((cached) => {
      if (cached && !settled && !controller.signal.aborted) setClaims(cached.data);
    });

    fetchHolderClaims(address, controller.signal)
      .then(({ claims: fetched }) => {
        settled = true;
        if (fetched.length > 0) void cacheSet(cacheKey, fetched);
        setClaims(fetched.length > 0 ? fetched : fixtureClaimsForHolder(address, policies));
      })
      .catch(() => {
        settled = true;
        if (controller.signal.aborted) return;
        setClaims(fixtureClaimsForHolder(address, policies));
      });

    return () => controller.abort();
  }, [address, policies]);

  return claims;
}

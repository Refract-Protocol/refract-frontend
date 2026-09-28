"use client";

import { useEffect, useState } from "react";
import { fetchHolderPolicies, type Policy } from "@/lib/api/policies";
import { fixtureHolderPolicies } from "@/lib/fixtures/policies";
import { ApiUnreachableError } from "@/lib/api/client";
import { cacheGet, cacheSet, STALE_AFTER_MS, walletCacheKey } from "@/lib/cache/indexedDb";

/** Cached entries older than this are discarded rather than shown. */
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60_000;

interface HolderPoliciesState {
  data: Policy[] | null;
  loading: boolean;
  error: string | null;
  isFixture: boolean;
  /** True while showing cached data older than STALE_AFTER_MS, before the fresh fetch resolves. */
  isStale: boolean;
}

/**
 * Loads a wallet's policies from GET /api/v1/policies/holder/:address — a
 * real backend route. Its in-memory store is empty on every process
 * restart though, so this also falls back to a labeled fixture both when
 * the API is unreachable AND when it legitimately returns zero policies,
 * so the dashboard has something to demo. `isFixture` tells the caller
 * which happened.
 *
 * Stale-while-revalidate: the last real (non-fixture) response is cached in
 * IndexedDB per wallet address and rendered immediately on mount, then
 * silently replaced once the fresh fetch resolves.
 */
export function useHolderPolicies(address: string | null): HolderPoliciesState {
  const [state, setState] = useState<HolderPoliciesState>({ data: null, loading: false, error: null, isFixture: false, isStale: false });

  useEffect(() => {
    if (!address) {
      setState({ data: null, loading: false, error: null, isFixture: false, isStale: false });
      return;
    }
    const controller = new AbortController();
    const cacheKey = walletCacheKey(address, "policies");
    let settled = false;
    setState({ data: null, loading: true, error: null, isFixture: false, isStale: false });

    cacheGet<Policy[]>(cacheKey, MAX_CACHE_AGE_MS).then((cached) => {
      if (!cached || settled || controller.signal.aborted) return;
      setState({
        data: cached.data,
        loading: false,
        error: null,
        isFixture: false,
        isStale: Date.now() - cached.timestamp > STALE_AFTER_MS,
      });
    });

    fetchHolderPolicies(address, controller.signal)
      .then(({ policies }) => {
        settled = true;
        if (policies.length > 0) {
          void cacheSet(cacheKey, policies);
          setState({ data: policies, loading: false, error: null, isFixture: false, isStale: false });
        } else {
          setState({ data: fixtureHolderPolicies(address), loading: false, error: null, isFixture: true, isStale: false });
        }
      })
      .catch((err) => {
        settled = true;
        if (controller.signal.aborted) return;
        if (err instanceof ApiUnreachableError) {
          setState({ data: fixtureHolderPolicies(address), loading: false, error: null, isFixture: true, isStale: false });
          return;
        }
        setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Failed to load policies", isFixture: false, isStale: false });
      });

    return () => controller.abort();
  }, [address]);

  return state;
}

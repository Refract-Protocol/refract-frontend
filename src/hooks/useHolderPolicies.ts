"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchHolderPolicies, type Policy } from "@/lib/api/policies";
import { fixtureHolderPolicies } from "@/lib/fixtures/policies";
import { queryFnWithFixtureFallback } from "@/lib/query/fixtureFallback";

interface HolderPoliciesState {
  data: Policy[] | null;
  loading: boolean;
  error: string | null;
  isFixture: boolean;
}

/**
 * Loads a wallet's policies from GET /api/v1/policies/holder/:address — a
 * real backend route. Its in-memory store is empty on every process
 * restart though, so this also falls back to a labeled fixture both when
 * the API is unreachable AND when it legitimately returns zero policies,
 * so the dashboard has something to demo. `isFixture` tells the caller
 * which happened.
 */
export function useHolderPolicies(address: string | null): HolderPoliciesState {
  const { data: result, isLoading } = useQuery({
    queryKey: ["holderPolicies", address],
    enabled: Boolean(address),
    queryFn: ({ signal }) =>
      queryFnWithFixtureFallback(
        async () => (await fetchHolderPolicies(address!, signal)).policies,
        () => fixtureHolderPolicies(address!),
        { signal, isEmpty: (policies) => policies.length === 0, errorMessage: "Failed to load policies" }
      ),
  });

  if (!address) return { data: null, loading: false, error: null, isFixture: false };
  return { data: result?.data ?? null, loading: isLoading, error: result?.error ?? null, isFixture: result?.isFixture ?? false };
}

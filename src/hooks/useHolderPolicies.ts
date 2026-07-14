"use client";

import { useEffect, useState } from "react";
import { fetchHolderPolicies, type Policy } from "@/lib/api/policies";
import { fixtureHolderPolicies } from "@/lib/fixtures/policies";
import { ApiUnreachableError } from "@/lib/api/client";

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
  const [state, setState] = useState<HolderPoliciesState>({ data: null, loading: false, error: null, isFixture: false });

  useEffect(() => {
    if (!address) {
      setState({ data: null, loading: false, error: null, isFixture: false });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));

    fetchHolderPolicies(address, controller.signal)
      .then(({ policies }) => {
        if (policies.length > 0) {
          setState({ data: policies, loading: false, error: null, isFixture: false });
        } else {
          setState({ data: fixtureHolderPolicies(address), loading: false, error: null, isFixture: true });
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiUnreachableError) {
          setState({ data: fixtureHolderPolicies(address), loading: false, error: null, isFixture: true });
          return;
        }
        setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Failed to load policies", isFixture: false });
      });

    return () => controller.abort();
  }, [address]);

  return state;
}

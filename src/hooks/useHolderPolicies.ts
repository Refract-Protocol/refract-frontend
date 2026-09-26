"use client";

import { useEffect, useState } from "react";
import { fetchHolderPolicies, type Policy } from "@/lib/api/policies";
import { fixtureHolderPolicies } from "@/lib/fixtures/policies";
import { ApiUnreachableError } from "@/lib/api/client";

/**
 * Where the returned policy list came from:
 * - `live`: the API responded with one or more real policies.
 * - `live-empty`: the API responded successfully with zero policies. This is
 *   a genuinely empty portfolio and must render the real empty state — never
 *   a fixture.
 * - `fixture-unreachable`: the API could not be reached, so labelled fixture
 *   data is shown instead.
 * - `fixture-demo`: fixture data was requested explicitly for demo purposes.
 */
export type HolderPoliciesSource = "live" | "live-empty" | "fixture-unreachable" | "fixture-demo";

interface HolderPoliciesState {
  data: Policy[] | null;
  loading: boolean;
  error: string | null;
  source: HolderPoliciesSource;
}

interface UseHolderPoliciesOptions {
  /**
   * Opt in to demo fixture data. When true, fixture policies are returned
   * with `source: "fixture-demo"` regardless of the API result, so reviewers
   * can exercise the populated dashboard without a live backend.
   */
  demo?: boolean;
}

/**
 * Loads a wallet's policies from GET /api/v1/policies/holder/:address — a
 * real backend route. Its in-memory store is empty on every process
 * restart, so a successful response with zero policies is treated as a
 * genuinely empty portfolio (`source: "live-empty"`, empty array) rather
 * than being conflated with an unreachable API. Only when the API is
 * unreachable do we fall back to labelled fixture data
 * (`source: "fixture-unreachable"`). Pass `{ demo: true }` to force fixture
 * data for demos (`source: "fixture-demo"`).
 */
export function useHolderPolicies(
  address: string | null,
  options: UseHolderPoliciesOptions = {},
): HolderPoliciesState {
  const { demo = false } = options;
  const [state, setState] = useState<HolderPoliciesState>({
    data: null,
    loading: false,
    error: null,
    source: "live",
  });

  useEffect(() => {
    if (!address) {
      setState({ data: null, loading: false, error: null, source: "live" });
      return;
    }
    if (demo) {
      setState({ data: fixtureHolderPolicies(address), loading: false, error: null, source: "fixture-demo" });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));

    fetchHolderPolicies(address, controller.signal)
      .then(({ policies }) => {
        if (policies.length > 0) {
          setState({ data: policies, loading: false, error: null, source: "live" });
        } else {
          setState({ data: [], loading: false, error: null, source: "live-empty" });
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiUnreachableError) {
          setState({ data: fixtureHolderPolicies(address), loading: false, error: null, source: "fixture-unreachable" });
          return;
        }
        setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Failed to load policies", source: "live" });
      });

    return () => controller.abort();
  }, [address, demo]);

  return state;
}

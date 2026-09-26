"use client";

import { useEffect, useState } from "react";
import { fetchRecentClaims, type ClaimRecord } from "@/lib/api/claims";
import { FIXTURE_RECENT_CLAIMS } from "@/lib/fixtures/recentClaims";

/**
 * Where the returned data came from. Distinguishes a genuinely empty
 * result from an unreachable API so callers can render the real empty
 * state instead of fabricated activity.
 *
 * - `live`: the API responded with one or more claims.
 * - `live-empty`: the API responded successfully with zero claims.
 * - `fixture-unreachable`: the API could not be reached; labelled fixture.
 * - `fixture-demo`: fixture data shown deliberately for demo mode.
 */
export type RecentClaimsSource = "live" | "live-empty" | "fixture-unreachable" | "fixture-demo";

interface RecentClaimsState {
  data: ClaimRecord[] | null;
  loading: boolean;
  source: RecentClaimsSource;
}

/**
 * Loads recent settlement activity from GET /api/v1/claims/recent for
 * public "recent payouts" displays.
 *
 * A successful response with zero claims resolves to `live-empty` with an
 * empty array so the caller can render the real empty state. Only an
 * unreachable API falls back to the labelled fixture
 * (`fixture-unreachable`). Pass `{ demo: true }` to force the fixture for
 * reviewers (`fixture-demo`).
 */
export function useRecentClaims(options?: { demo?: boolean }): RecentClaimsState {
  const demo = options?.demo ?? false;
  const [state, setState] = useState<RecentClaimsState>({
    data: demo ? FIXTURE_RECENT_CLAIMS : null,
    loading: !demo,
    source: demo ? "fixture-demo" : "live",
  });

  useEffect(() => {
    if (demo) {
      setState({ data: FIXTURE_RECENT_CLAIMS, loading: false, source: "fixture-demo" });
      return;
    }

    const controller = new AbortController();
    fetchRecentClaims(controller.signal)
      .then(({ claims }) => {
        setState(
          claims.length > 0
            ? { data: claims, loading: false, source: "live" }
            : { data: [], loading: false, source: "live-empty" }
        );
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState({ data: FIXTURE_RECENT_CLAIMS, loading: false, source: "fixture-unreachable" });
      });
    return () => controller.abort();
  }, [demo]);

  return state;
}

"use client";

import { useEffect, useState } from "react";
import { fetchRecentClaims, type ClaimRecord } from "@/lib/api/claims";
import { FIXTURE_RECENT_CLAIMS } from "@/lib/fixtures/recentClaims";

interface RecentClaimsState {
  data: ClaimRecord[] | null;
  loading: boolean;
  isFixture: boolean;
}

/**
 * Loads recent settlement activity from GET /api/v1/claims/recent for
 * public "recent payouts" displays. Falls back to a labeled fixture both
 * when the API is unreachable AND when it legitimately returns zero
 * claims (a fresh deployment has none yet), same convention as the other
 * data hooks in this app.
 */
export function useRecentClaims(): RecentClaimsState {
  const [state, setState] = useState<RecentClaimsState>({ data: null, loading: true, isFixture: false });

  useEffect(() => {
    const controller = new AbortController();
    fetchRecentClaims(controller.signal)
      .then(({ claims }) => {
        setState(
          claims.length > 0
            ? { data: claims, loading: false, isFixture: false }
            : { data: FIXTURE_RECENT_CLAIMS, loading: false, isFixture: true }
        );
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState({ data: FIXTURE_RECENT_CLAIMS, loading: false, isFixture: true });
      });
    return () => controller.abort();
  }, []);

  return state;
}

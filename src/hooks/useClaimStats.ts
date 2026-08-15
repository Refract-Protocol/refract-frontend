"use client";

import { useEffect, useState } from "react";
import { fetchClaimStats, type ClaimStats } from "@/lib/api/claims";
import { FIXTURE_CLAIM_STATS } from "@/lib/fixtures/claimStats";

interface ClaimStatsState {
  data: ClaimStats | null;
  loading: boolean;
  isFixture: boolean;
}

/** Loads protocol-wide claim stats from GET /api/v1/claims/stats, falling back to the bundled fixture offline. */
export function useClaimStats(): ClaimStatsState {
  const [state, setState] = useState<ClaimStatsState>({ data: null, loading: true, isFixture: false });

  useEffect(() => {
    const controller = new AbortController();
    fetchClaimStats(controller.signal)
      .then((data) => setState({ data, loading: false, isFixture: false }))
      .catch(() => {
        if (controller.signal.aborted) return;
        setState({ data: FIXTURE_CLAIM_STATS, loading: false, isFixture: true });
      });
    return () => controller.abort();
  }, []);

  return state;
}

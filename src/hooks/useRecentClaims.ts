"use client";

import { useEffect, useState } from "react";
import { fetchRecentClaims } from "@/lib/api/claims";
import type { ClaimRecord } from "@/lib/api/claims";
import { FIXTURE_RECENT_CLAIMS } from "@/lib/fixtures/recentClaims";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import {
  mergeClaims,
  normalizeClaimFrame,
  normalizeRestClaim,
  type StreamClaim,
} from "@/lib/realtime/claims";
import { realtimeClient, type RealtimeState } from "@/lib/realtime/client";

export function useRecentClaims() {
  const enabled = useFeatureFlag("realtime-claims-settlement");
  const [restRows, setRestRows] = useState<StreamClaim[]>([]);
  const [pushedRows, setPushedRows] = useState<StreamClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFixture, setIsFixture] = useState(false);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    fetchRecentClaims({ limit: 20 }, controller.signal)
      .then((page) => {
        if (!active) return;
        setRestRows(page.items.map(normalizeRestClaim));
        setIsFixture(false);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setRestRows(FIXTURE_RECENT_CLAIMS.map(normalizeRestClaim));
        setIsFixture(true);
        setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsStale(false);
      return;
    }
    return realtimeClient.subscribe(
      "claims.settlement",
      (payload) => {
        const claim = normalizeClaimFrame(payload);
        if (
          !claim ||
          (claim.status && ["rejected", "failed", "cancelled"].includes(claim.status.toLowerCase()))
        )
          return;
        setPushedRows((current) => mergeClaims(current, [claim]));
      },
      { onState: (state: RealtimeState) => setIsStale(state !== "live") }
    );
  }, [enabled]);

  // A page arriving after a push replaces the REST page source; merging here
  // keeps the cursor buffer untouched and removes any event/page duplicate.
  const data = mergeClaims(restRows, pushedRows, 20) as ClaimRecord[];
  return { data, loading, isFixture, isStale };
}

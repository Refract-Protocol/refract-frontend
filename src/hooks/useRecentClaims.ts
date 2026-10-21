"use client";
import { useCallback } from "react";
import { fetchRecentClaims, type ClaimRecord } from "@/lib/api/claims";
import { FIXTURE_RECENT_CLAIMS } from "@/lib/fixtures/recentClaims";
import { useRealtimeResource } from "@/lib/realtime/useRealtimeResource";

export function useRecentClaims() {
  const fetcher = useCallback(
    async (signal: AbortSignal) => (await fetchRecentClaims({ limit: 12 }, signal)).items,
    []
  );
  const resource = useRealtimeResource<ClaimRecord[]>({
    topic: "claims.recent",
    flag: "realtime-recent-claims",
    fetcher,
    fixture: () => FIXTURE_RECENT_CLAIMS,
    mergeEvent: (payload, current) => {
      if (Array.isArray(payload)) return payload as ClaimRecord[];
      if (!payload || typeof payload !== "object") return null;
      if (Array.isArray((payload as { items?: unknown }).items))
        return (payload as { items: ClaimRecord[] }).items;
      if (!("policyId" in payload)) return null;
      const claim = payload as ClaimRecord;
      return [claim, ...(current ?? []).filter((item) => item.policyId !== claim.policyId)].slice(
        0,
        12
      );
    },
  });
  return {
    data: resource.data,
    loading: resource.loading,
    error: resource.error,
    isFixture: resource.isFixture,
    lastUpdated: resource.lastUpdated,
    isRefreshing: resource.isRefreshing,
    refresh: resource.refresh,
  };
}

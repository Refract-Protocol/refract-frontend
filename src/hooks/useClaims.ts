"use client";
import { useCallback } from "react";
import { fetchHolderClaims, type ClaimRecord } from "@/lib/api/claims";
import type { Policy } from "@/lib/api/policies";
import { fixtureClaimsForHolder } from "@/lib/fixtures/claims";
import { useRealtimeResource } from "@/lib/realtime/useRealtimeResource";

export function useClaims(address?: string | null, policies?: Policy[] | null) {
  const fetcher = useCallback(
    async (signal: AbortSignal) =>
      address ? (await fetchHolderClaims(address, { limit: 100 }, signal)).items : [],
    [address]
  );
  const fixture = useCallback(
    () => (address && policies ? fixtureClaimsForHolder(address, policies) : []),
    [address, policies]
  );
  const resource = useRealtimeResource<ClaimRecord[]>({
    topic: address ? `claims.holder.${address}` : "claims.holder",
    flag: "realtime-holder-claims",
    fetcher,
    fixture,
    mergeEvent: (payload, current) => {
      if (Array.isArray(payload)) return payload as ClaimRecord[];
      if (!payload || typeof payload !== "object") return null;
      if (Array.isArray((payload as { items?: unknown }).items))
        return (payload as { items: ClaimRecord[] }).items;
      if (!("policyId" in payload)) return null;
      const claim = payload as ClaimRecord;
      return [claim, ...(current ?? []).filter((item) => item.policyId !== claim.policyId)];
    },
  });
  return {
    data: address ? (resource.data ?? []) : [],
    loading: resource.loading,
    isRefreshing: resource.isRefreshing,
    isFixture: resource.isFixture,
    refresh: resource.refresh,
  };
}

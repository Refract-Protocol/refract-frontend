"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchRecentClaims, type ClaimRecord } from "@/lib/api/claims";
import { FIXTURE_RECENT_CLAIMS } from "@/lib/fixtures/recentClaims";
import { queryFnWithFixtureFallback } from "@/lib/query/fixtureFallback";
import { realtimeClient } from "@/lib/realtime/client";

export function useRecentClaims() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["recentClaims"],
    queryFn: ({ signal }) =>
      queryFnWithFixtureFallback(
        () => fetchRecentClaims({ limit: 10 }, signal),
        () => ({ items: FIXTURE_RECENT_CLAIMS, hasMore: false }),
        { signal, fallbackOnAnyError: true }
      ),
    refetchInterval: 60_000,
  });
  useEffect(
    () =>
      realtimeClient.subscribe("claim_update", (payload) => {
        const claim = payload as ClaimRecord;
        if (!claim || typeof claim !== "object" || typeof claim.policyId !== "string") return;
        client.setQueryData(
          ["recentClaims"],
          (
            current:
              { data: { items: ClaimRecord[]; hasMore: boolean }; isFixture: boolean } | undefined
          ) => ({
            data: {
              items: [
                claim,
                ...(current?.data.items ?? []).filter((item) => item.policyId !== claim.policyId),
              ].slice(0, 10),
              hasMore: current?.data.hasMore ?? false,
            },
            isFixture: false,
          })
        );
      }),
    [client]
  );
  return {
    data: query.data?.data?.items ?? [],
    loading: query.isLoading,
    isFixture: query.data?.isFixture ?? false,
    lastUpdated: query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : undefined,
    dataSource: query.data?.isFixture ? ("fixture" as const) : ("api" as const),
  };
}

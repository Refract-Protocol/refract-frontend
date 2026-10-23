"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPoolStats, type PoolStats } from "@/lib/api/pool";
import { FIXTURE_POOL_STATS } from "@/lib/fixtures/poolStats";
import { ApiUnreachableError } from "@/lib/api/client";
import { readPoolStats } from "@/lib/stellar/rpc";
import { realtimeClient } from "@/lib/realtime/client";

export function usePoolStats() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["poolStats"],
    queryFn: async ({ signal }) => {
      try {
        return {
          data: await fetchPoolStats(signal),
          dataSource: "api" as const,
          isFixture: false,
          error: undefined,
        };
      } catch (apiError) {
        if (!(apiError instanceof ApiUnreachableError))
          return {
            data: null,
            dataSource: null,
            isFixture: false,
            error: apiError instanceof Error ? apiError.message : "Failed to load pool stats",
          };
        try {
          return {
            data: await readPoolStats(),
            dataSource: "chain" as const,
            isFixture: false,
            error: undefined,
          };
        } catch {
          return {
            data: FIXTURE_POOL_STATS,
            dataSource: "fixture" as const,
            isFixture: true,
            error: undefined,
          };
        }
      }
    },
    refetchInterval: 60_000,
  });
  useEffect(
    () =>
      realtimeClient.subscribe("pool_update", (payload) => {
        if (!payload || typeof payload !== "object") return;
        client.setQueryData(["poolStats"], {
          data: payload as PoolStats,
          dataSource: "realtime",
          isFixture: false,
        });
      }),
    [client]
  );
  const fixture = query.data?.isFixture ?? false;
  return {
    data: query.data?.data ?? null,
    loading: query.isLoading,
    isFixture: fixture,
    dataSource: query.data?.dataSource ?? null,
    lastUpdated: query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : undefined,
    error: query.error?.message,
    refreshFromChain: readPoolStats,
  };
}

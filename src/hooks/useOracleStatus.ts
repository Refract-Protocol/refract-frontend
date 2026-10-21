"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchOracleStatus, type OracleReading } from "@/lib/api/oracle";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";
import { queryFnWithFixtureFallback, type FixtureResult } from "@/lib/query/fixtureFallback";
import { realtimeClient } from "@/lib/realtime/client";

export function useOracleStatus() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["oracleStatus"],
    queryFn: async ({
      signal,
    }): Promise<
      FixtureResult<{ readings: OracleReading[] }> & { source?: "api" | "fixture" | "realtime" }
    > => {
      const result = await queryFnWithFixtureFallback(
        () => fetchOracleStatus(signal),
        () => ({ readings: FIXTURE_ORACLE_READINGS }),
        { signal, fallbackOnAnyError: true }
      );
      return { ...result, source: result.isFixture ? "fixture" : "api" };
    },
    refetchInterval: 60_000,
  });
  useEffect(
    () =>
      realtimeClient.subscribe("oracle_update", (payload) => {
        const reading = payload as OracleReading;
        if (!reading || typeof reading !== "object" || typeof reading.coverageType !== "string")
          return;
        client.setQueryData(
          ["oracleStatus"],
          (
            current:
              | { data: { readings: OracleReading[] }; isFixture: boolean; source?: string }
              | undefined
          ) => ({
            data: {
              readings: [
                ...(current?.data.readings ?? []).filter(
                  (item) => item.coverageType !== reading.coverageType
                ),
                reading,
              ],
            },
            isFixture: false,
            source: "realtime",
          })
        );
      }),
    [client]
  );
  const result = query.data?.data;
  return {
    data: result?.readings ?? null,
    loading: query.isLoading,
    isFixture: query.data?.isFixture ?? false,
    lastUpdated: query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : undefined,
    dataSource: query.data?.isFixture
      ? ("fixture" as const)
      : query.data?.source === "realtime"
        ? ("realtime" as const)
        : ("api" as const),
    isRefreshing: query.isFetching,
    refresh: query.refetch,
  };
}

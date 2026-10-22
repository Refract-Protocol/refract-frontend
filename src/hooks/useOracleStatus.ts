"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchOracleStatus, type OracleReading } from "@/lib/api/oracle";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";
import { queryFnWithFixtureFallback } from "@/lib/query/fixtureFallback";

export interface OracleStatusState {
  data: OracleReading[] | null;
  loading: boolean;
  isFixture: boolean;
  /** When the readings were last refreshed, or null before the first load. */
  lastUpdated: Date | null;
  /** True while a manual or background refresh is in flight after the first load. */
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

/**
 * Loads live oracle readings from GET /api/v1/oracle/status. This card is
 * purely informational, so any failure (unreachable API, network error,
 * etc.) falls back to the labeled fixture rather than showing an error state.
 */
export function useOracleStatus(): OracleStatusState {
  const {
    data: result,
    isLoading,
    isRefetching,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ["oracleStatus"],
    queryFn: ({ signal }) =>
      queryFnWithFixtureFallback(
        async () => (await fetchOracleStatus(signal)).readings,
        () => FIXTURE_ORACLE_READINGS,
        { signal, fallbackOnAnyError: true }
      ),
    refetchInterval: 60_000,
  });

  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: result?.data ?? null,
    loading: isLoading,
    isFixture: result?.isFixture ?? false,
    lastUpdated: dataUpdatedAt ? new Date(dataUpdatedAt) : null,
    isRefreshing: isRefetching,
    refresh,
  };
}

"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchOracleStatus, type OracleReading } from "@/lib/api/oracle";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";
import { queryFnWithFixtureFallback, type FixtureResult } from "@/lib/query/fixtureFallback";
import { useAdaptivePolling } from "./useAdaptivePolling";
import { useRealtimeTopic } from "./useRealtimeTopic";

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

const QUERY_KEY = ["oracleStatus"] as const;

/** Replaces the reading for the same coverage type, or appends a new one. */
export function mergeOracleReading(
  readings: OracleReading[],
  next: OracleReading
): OracleReading[] {
  const index = readings.findIndex((r) => r.coverageType === next.coverageType);
  if (index === -1) return [...readings, next];
  const copy = readings.slice();
  copy[index] = next;
  return copy;
}

/**
 * Loads live oracle readings from GET /api/v1/oracle/status, merges
 * `oracle_update` realtime frames into the same cache entry, and polls at a
 * cadence set by realtime health (critical tier). This card is purely
 * informational, so any REST failure falls back to the labeled fixture.
 */
export function useOracleStatus(): OracleStatusState {
  const queryClient = useQueryClient();
  const refetchInterval = useAdaptivePolling({
    topic: "oracle_update",
    tier: "critical",
    queryKey: QUERY_KEY,
  });

  const {
    data: result,
    isLoading,
    isRefetching,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ signal }) =>
      queryFnWithFixtureFallback(
        async () => (await fetchOracleStatus(signal)).readings,
        () => FIXTURE_ORACLE_READINGS,
        { signal, fallbackOnAnyError: true }
      ),
    refetchInterval,
  });

  useRealtimeTopic("oracle_update", (reading) => {
    queryClient.setQueryData<FixtureResult<OracleReading[]>>(QUERY_KEY, (prev) =>
      prev?.data ? { ...prev, data: mergeOracleReading(prev.data, reading) } : prev
    );
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

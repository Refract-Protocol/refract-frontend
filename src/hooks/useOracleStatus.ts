"use client";
import { useCallback } from "react";
import { fetchOracleStatus, type OracleReading } from "@/lib/api/oracle";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";
import { useRealtimeResource } from "@/lib/realtime/useRealtimeResource";

export function useOracleStatus() {
  const fetcher = useCallback(
    async (signal: AbortSignal) => (await fetchOracleStatus(signal)).readings,
    []
  );
  const resource = useRealtimeResource<OracleReading[]>({
    topic: "oracle.status",
    flag: "realtime-oracle",
    fetcher,
    fixture: () => FIXTURE_ORACLE_READINGS,
    mergeEvent: (payload, current) => {
      const reading =
        payload && typeof payload === "object" && "coverageType" in payload && "value" in payload
          ? (payload as OracleReading)
          : null;
      if (Array.isArray(payload)) return payload as OracleReading[];
      if (
        payload &&
        typeof payload === "object" &&
        Array.isArray((payload as { readings?: unknown }).readings)
      )
        return (payload as { readings: OracleReading[] }).readings;
      if (!reading) return null;
      return [
        ...(current ?? []).filter((item) => item.coverageType !== reading.coverageType),
        reading,
      ];
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

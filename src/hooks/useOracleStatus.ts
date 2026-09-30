"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchOracleStatus, type OracleReading } from "@/lib/api/oracle";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";
import { queryFnWithFixtureFallback } from "@/lib/query/fixtureFallback";

interface OracleStatusState {
  data: OracleReading[] | null;
  loading: boolean;
  isFixture: boolean;
}

/**
 * Loads live oracle readings from GET /api/v1/oracle/status. This card is
 * purely informational, so any failure (unreachable API, network error,
 * etc.) falls back to the labeled fixture rather than showing an error state.
 */
export function useOracleStatus(): OracleStatusState {
  const { data: result, isLoading } = useQuery({
    queryKey: ["oracleStatus"],
    queryFn: ({ signal }) =>
      queryFnWithFixtureFallback(
        async () => (await fetchOracleStatus(signal)).readings,
        () => FIXTURE_ORACLE_READINGS,
        { signal, fallbackOnAnyError: true }
      ),
  });

  return { data: result?.data ?? null, loading: isLoading, isFixture: result?.isFixture ?? false };
}

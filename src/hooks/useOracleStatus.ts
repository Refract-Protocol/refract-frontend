"use client";
import { useEffect, useState } from "react";
import { fetchOracleStatus, type OracleReading } from "@/lib/api/oracle";
import { ApiUnreachableError } from "@/lib/api/client";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import { useRealtimeRevision } from "./useRealtimeTopic";
/** REST remains authoritative; subscriptions only trigger a coalesced refresh. */
export function useOracleStatus(seriesId?: string | null) {
  const enabled = useFeatureFlag("realtime-oracle");
  const [state, setState] = useState<{
    data: OracleReading[] | null;
    loading: boolean;
    isFixture: boolean;
    error: string | null;
  }>({ data: null, loading: true, isFixture: false, error: null });
  const revision = useRealtimeRevision(
    "oracle_update",
    enabled && seriesId !== null ? (seriesId ? { entityIds: [seriesId] } : { broad: true }) : null
  );
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchOracleStatus(controller.signal)
        .then((result) => {
          if (!controller.signal.aborted)
            setState({ data: result.readings, loading: false, isFixture: false, error: null });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({
              data: error instanceof ApiUnreachableError ? FIXTURE_ORACLE_READINGS : null,
              loading: false,
              isFixture: error instanceof ApiUnreachableError,
              error: error instanceof ApiUnreachableError ? null : String(error),
            });
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [revision]);
  return {
    ...state,
    data: seriesId
      ? (state.data?.filter((r) => String(r.coverageType) === seriesId) ?? null)
      : state.data,
  };
}

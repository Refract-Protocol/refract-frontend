"use client";

import { useCallback, useState } from "react";
import { fetchOracleStatus, type OracleReading } from "@/lib/api/oracle";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";
import { usePolling } from "./usePolling";

export const ORACLE_POLL_INTERVAL_MS = 60_000;

export interface OracleStatusState {
  data: OracleReading[] | null;
  loading: boolean;
  isFixture: boolean;
  lastUpdated: Date | null;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

export function useOracleStatus(): OracleStatusState {
  const [state, setState] = useState<Omit<OracleStatusState, "refresh">>({
    data: null,
    loading: true,
    isFixture: false,
    lastUpdated: null,
    isRefreshing: false,
  });
  const load = useCallback(async (signal: AbortSignal) => {
    setState((current) => ({ ...current, isRefreshing: current.data !== null }));
    try {
      const { readings } = await fetchOracleStatus(signal);
      if (!signal.aborted)
        setState({
          data: readings,
          loading: false,
          isFixture: false,
          lastUpdated: new Date(),
          isRefreshing: false,
        });
    } catch {
      if (!signal.aborted) {
        setState((current) => ({
          data: current.data ?? FIXTURE_ORACLE_READINGS,
          loading: false,
          isFixture: current.data ? current.isFixture : true,
          lastUpdated: new Date(),
          isRefreshing: false,
        }));
      }
    }
  }, []);
  const { refresh } = usePolling(load, ORACLE_POLL_INTERVAL_MS);
  return { ...state, refresh };
}

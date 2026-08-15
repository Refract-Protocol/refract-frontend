"use client";

import { useEffect, useState } from "react";
import { fetchOracleStatus, type OracleReading } from "@/lib/api/oracle";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";

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
  const [state, setState] = useState<OracleStatusState>({ data: null, loading: true, isFixture: false });

  useEffect(() => {
    const controller = new AbortController();
    fetchOracleStatus(controller.signal)
      .then(({ readings }) => setState({ data: readings, loading: false, isFixture: false }))
      .catch(() => {
        if (controller.signal.aborted) return;
        setState({ data: FIXTURE_ORACLE_READINGS, loading: false, isFixture: true });
      });
    return () => controller.abort();
  }, []);

  return state;
}

"use client";

import { useEffect, useState } from "react";
import { fetchPoolStats, type PoolStats } from "@/lib/api/pool";
import { FIXTURE_POOL_STATS } from "@/lib/fixtures/poolStats";
import { ApiUnreachableError } from "@/lib/api/client";
import { readPoolStats } from "@/lib/stellar/rpc";
import type { DataSource } from "@/lib/api/dataSource";

interface PoolStatsState {
  data: PoolStats | null;
  loading: boolean;
  error: string | null;
  /** Convenience: true only for the static-fixture tier. */
  isFixture: boolean;
  dataSource: DataSource | null;
}

/** Loads pool-wide stats from GET /api/v1/pool/stats, falling back to a direct Soroban RPC read, then the bundled fixture. On the "chain" tier `apyBps` is unavailable (backend-computed) and is 0. */
export function usePoolStats(): PoolStatsState {
  const [state, setState] = useState<PoolStatsState>({ data: null, loading: true, error: null, isFixture: false, dataSource: null });

  useEffect(() => {
    const controller = new AbortController();
    fetchPoolStats(controller.signal)
      .then((data) => setState({ data, loading: false, error: null, isFixture: false, dataSource: "api" }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiUnreachableError) {
          readPoolStats(controller.signal)
            .then((data) => {
              if (!controller.signal.aborted) setState({ data, loading: false, error: null, isFixture: false, dataSource: "chain" });
            })
            .catch(() => {
              if (!controller.signal.aborted) {
                setState({ data: FIXTURE_POOL_STATS, loading: false, error: null, isFixture: true, dataSource: "fixture" });
              }
            });
          return;
        }
        setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Failed to load pool stats", isFixture: false, dataSource: null });
      });
    return () => controller.abort();
  }, []);

  return state;
}

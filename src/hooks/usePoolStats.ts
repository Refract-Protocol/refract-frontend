"use client";
import { useEffect, useState } from "react";
import { fetchPoolStats, type PoolStats } from "@/lib/api/pool";
import { ApiUnreachableError } from "@/lib/api/client";
import { readPoolStats } from "@/lib/stellar/rpc";
import { FIXTURE_POOL_STATS } from "@/lib/fixtures/poolStats";
import type { DataSource } from "@/lib/api/dataSource";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import { useRealtimeRevision } from "./useRealtimeTopic";
import { ACTIVE_NETWORK } from "@/lib/network";
/** The current app views one protocol pool per network. */
export function usePoolStats(poolId = `${ACTIVE_NETWORK.id}:protocol`) {
  const enabled = useFeatureFlag("realtime-pool");
  const [state, setState] = useState<{
    data: PoolStats | null;
    loading: boolean;
    isFixture: boolean;
    error: string | null;
    dataSource: DataSource | null;
  }>({ data: null, loading: true, isFixture: false, error: null, dataSource: null });
  const revision = useRealtimeRevision("pool_stats", enabled ? { entityIds: [poolId] } : null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      let data: PoolStats | null = null;
      let dataSource: DataSource | null = null;
      let error: string | null = null;
      try {
        data = await fetchPoolStats(controller.signal);
        dataSource = "api";
      } catch (err) {
        if (err instanceof ApiUnreachableError) {
          try {
            data = await readPoolStats();
            dataSource = "chain";
          } catch {
            data = FIXTURE_POOL_STATS;
            dataSource = "fixture";
          }
        } else error = err instanceof Error ? err.message : String(err);
      }
      if (!controller.signal.aborted)
        setState({ data, loading: false, isFixture: dataSource === "fixture", dataSource, error });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [revision]);
  return state;
}

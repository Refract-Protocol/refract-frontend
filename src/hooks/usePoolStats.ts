"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiUnreachableError } from "@/lib/api/client";
import type { DataSource } from "@/lib/api/dataSource";
import { fetchPoolStats, type PoolStats } from "@/lib/api/pool";
import { FIXTURE_POOL_STATS } from "@/lib/fixtures/poolStats";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import { realtimeClient } from "@/lib/realtime/client";
import { readPoolStats } from "@/lib/stellar/rpc";

interface PoolStatsState {
  data: PoolStats | null;
  loading: boolean;
  error: string | null;
  isFixture: boolean;
  dataSource: DataSource | null;
  /** True when the live stream is enabled but disconnected, so `data` is the REST snapshot. */
  isStale: boolean;
}

interface PoolStatsResult {
  data: PoolStats | null;
  dataSource: DataSource | null;
  error: string | null;
}

const NUMERIC_FIELDS: (keyof PoolStats)[] = ["utilizationBps", "apyBps", "sharePrice", "maxUtilizationBps"];
const STRING_FIELDS: (keyof PoolStats)[] = ["totalUsdc", "totalShares", "lockedUsdc", "premiumAccrued", "availableUsdc"];
/** A pushed TVL differing from REST by more than this ratio is treated as a bad frame. */
const MAX_TVL_DRIFT = 0.5;

/** Pushed frames are full snapshots; reject anything partial rather than half-applying it. */
function isFullSnapshot(p: unknown): p is PoolStats {
  const o = p as Record<string, unknown> | null;
  return (
    !!o &&
    NUMERIC_FIELDS.every((k) => typeof o[k] === "number" && Number.isFinite(o[k] as number)) &&
    STRING_FIELDS.every((k) => typeof o[k] === "string" && /^\d+$/.test(o[k] as string))
  );
}

function agreesWithRest(pushed: PoolStats, rest: PoolStats | null): boolean {
  const base = Number(rest?.totalUsdc ?? 0);
  if (!rest || base === 0) return true;
  return Math.abs(Number(pushed.totalUsdc) - base) / base <= MAX_TVL_DRIFT;
}

/**
 * Pool-wide stats: API → on-chain read → bundled fixture, optionally kept live
 * by the `pool.stats` realtime topic (behind the `realtime-pool-stats` flag).
 */
export function usePoolStats(): PoolStatsState {
  const live = useFeatureFlag("realtime-pool-stats");
  const queryClient = useQueryClient();
  const [pushed, setPushed] = useState<PoolStats | null>(null);
  const [connected, setConnected] = useState(realtimeClient.getStatus() === "open");

  const { data: result, isLoading } = useQuery<PoolStatsResult>({
    queryKey: ["poolStats"],
    queryFn: async ({ signal }) => {
      try {
        return { data: await fetchPoolStats(signal), dataSource: "api", error: null };
      } catch (err) {
        if (signal?.aborted) throw err;
        if (!(err instanceof ApiUnreachableError)) {
          return { data: null, dataSource: null, error: err instanceof Error ? err.message : "Failed to load pool stats" };
        }
        try {
          return { data: await readPoolStats(signal), dataSource: "chain", error: null };
        } catch {
          return { data: FIXTURE_POOL_STATS, dataSource: "fixture", error: null };
        }
      }
    },
  });

  const rest = result?.data ?? null;

  useEffect(() => {
    if (!live) return;
    setConnected(realtimeClient.getStatus() === "open");
    const offStatus = realtimeClient.onStatus((s) => setConnected(s === "open"));
    const off = realtimeClient.subscribe("pool.stats", (payload) => {
      if (!isFullSnapshot(payload)) return;
      const current = queryClient.getQueryData<PoolStatsResult>(["poolStats"])?.data ?? null;
      if (agreesWithRest(payload, current)) setPushed(payload);
      else {
        setPushed(null);
        void queryClient.invalidateQueries({ queryKey: ["poolStats"] });
      }
    });
    return () => {
      off();
      offStatus();
    };
  }, [live, queryClient]);

  // On disconnect fall back to the REST snapshot.
  const useLive = live && connected && pushed !== null;

  return {
    data: useLive ? pushed : rest,
    loading: isLoading,
    error: result?.error ?? null,
    isFixture: result?.dataSource === "fixture",
    dataSource: result?.dataSource ?? null,
    isStale: live && !connected,
  };
}

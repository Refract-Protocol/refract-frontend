"use client";
import { useCallback, useMemo } from "react";
import { fetchPoolStats } from "@/lib/api/pool";
import { fetchClaimStats } from "@/lib/api/claims";
import { FIXTURE_POOL_STATS } from "@/lib/fixtures/poolStats";
import { FIXTURE_CLAIM_STATS } from "@/lib/fixtures/claimStats";
import { useRealtimeResource } from "@/lib/realtime/useRealtimeResource";

export interface ProtocolStats {
  tvl: string;
  activePolicies: number;
  cumulativePayouts: string;
  asOf?: string;
  sequence?: number;
}
export function useProtocolStats() {
  const fetcher = useCallback(async (signal: AbortSignal): Promise<ProtocolStats> => {
    const [pool, claims] = await Promise.all([fetchPoolStats(signal), fetchClaimStats(signal)]);
    return {
      tvl: pool.totalUsdc,
      activePolicies: claims.activePolicies,
      cumulativePayouts: claims.totalPayout,
    };
  }, []);
  const fixture = useCallback(
    (): ProtocolStats => ({
      tvl: FIXTURE_POOL_STATS.totalUsdc,
      activePolicies: FIXTURE_CLAIM_STATS.activePolicies,
      cumulativePayouts: FIXTURE_CLAIM_STATS.totalPayout,
    }),
    []
  );
  const resource = useRealtimeResource<ProtocolStats>({
    topic: "protocol.stats",
    flag: "realtime-protocol-stats",
    fetcher,
    fixture,
    mergeEvent: (payload, current) => {
      if (!payload || typeof payload !== "object" || !current) return null;
      const delta = payload as Partial<ProtocolStats>;
      if (
        delta.tvl === undefined &&
        delta.activePolicies === undefined &&
        delta.cumulativePayouts === undefined
      )
        return null;
      return { ...current, ...delta };
    },
    getRestKey: (data) => ({
      sequence: data.sequence,
      timestamp: data.asOf ? Date.parse(data.asOf) : undefined,
    }),
  });
  const { data, loading, error, isFixture, isRefreshing, refresh } = resource;
  // Expose individual fields so consumers can subscribe per-field and avoid
  // re-rendering when an unrelated stat changes. The returned object is
  // memoized on the individual field values so it stays referentially stable
  // across unrelated updates.
  const tvl = data?.tvl;
  const activePolicies = data?.activePolicies;
  const cumulativePayouts = data?.cumulativePayouts;
  return useMemo(
    () => ({
      data,
      tvl,
      activePolicies,
      cumulativePayouts,
      loading,
      error,
      isFixture,
      isRefreshing,
      refresh,
    }),
    [
      data,
      tvl,
      activePolicies,
      cumulativePayouts,
      loading,
      error,
      isFixture,
      isRefreshing,
      refresh,
    ]
  );
}

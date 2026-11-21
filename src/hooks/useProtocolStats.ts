"use client";
import { useCallback } from "react";
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

export type ProtocolStatKey = "tvl" | "activePolicies" | "cumulativePayouts";

export interface ProtocolStatsResource {
  data: ProtocolStats | null;
  loading: boolean;
  error: unknown;
  isFixture: boolean;
  isRefreshing: boolean;
  refresh: () => void;
}

/**
 * Select a single field from the protocol stats resource.
 *
 * Consumers should use this (or the per-field hooks below) instead of reading
 * the whole `data` object, so that a change to one stat does not re-render
 * components that only care about another stat.
 */
export function selectProtocolStat<K extends ProtocolStatKey>(
  resource: ProtocolStatsResource,
  key: K
): ProtocolStats[K] | undefined {
  return resource.data ? resource.data[key] : undefined;
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
  return {
    data: resource.data,
    loading: resource.loading,
    error: resource.error,
    isFixture: resource.isFixture,
    isRefreshing: resource.isRefreshing,
    refresh: resource.refresh,
  };
}

/**
 * Subscribe to a single protocol stat. The returned value only changes when
 * that specific field changes, so unrelated sections do not re-render.
 */
export function useProtocolStat<K extends ProtocolStatKey>(key: K): ProtocolStats[K] | undefined {
  const resource = useProtocolStats();
  return selectProtocolStat(resource, key);
}

export function useProtocolTvl(): string | undefined {
  return useProtocolStat("tvl");
}

export function useActivePolicies(): number | undefined {
  return useProtocolStat("activePolicies");
}

export function useCumulativePayouts(): string | undefined {
  return useProtocolStat("cumulativePayouts");
}

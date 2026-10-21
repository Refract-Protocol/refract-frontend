"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchOracleStatus, type OracleReading } from "@/lib/api/oracle";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import { realtimeClient, type RealtimeState } from "@/lib/realtime/client";

export function useOracleStatus() {
  const enabled = useFeatureFlag("realtime-oracle");
  const [data, setData] = useState<OracleReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFixture, setIsFixture] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await fetchOracleStatus();
      setData(result.readings);
      setIsFixture(false);
      setLastUpdated(new Date());
    } catch {
      setData(FIXTURE_ORACLE_READINGS);
      setIsFixture(true);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const load = () =>
      fetchOracleStatus(controller.signal)
        .then((result) => {
          if (!active) return;
          setData(result.readings);
          setIsFixture(false);
          setLastUpdated(new Date());
          setLoading(false);
        })
        .catch(() => {
          if (!active) return;
          setData(FIXTURE_ORACLE_READINGS);
          setIsFixture(true);
          setLastUpdated(new Date());
          setLoading(false);
        });
    void load();
    const interval = setInterval(load, 60_000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsStale(false);
      return;
    }
    return realtimeClient.subscribe(
      "oracle_update",
      (payload) => {
        const value =
          payload && typeof payload === "object" && "reading" in payload
            ? (payload as { reading: unknown }).reading
            : payload;
        if (!value || typeof value !== "object") return;
        const reading = value as OracleReading;
        if (!reading.coverageType) return;
        setData((current) => [
          reading,
          ...current.filter((item) => item.coverageType !== reading.coverageType),
        ]);
        setIsFixture(false);
        setLastUpdated(new Date());
      },
      { onState: (state: RealtimeState) => setIsStale(state !== "live") }
    );
  }, [enabled]);

  return { data, loading, isFixture, isStale, lastUpdated, refresh, isRefreshing };
}

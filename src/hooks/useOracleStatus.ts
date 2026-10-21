"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchOracleStatus } from "@/lib/api/oracle";
import type { OracleReading } from "@/lib/domain/realtime";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import { mapOracleUpdate } from "@/lib/realtime/mappers";
import { REALTIME_TOPICS } from "@/lib/realtime/contract";
import { useRealtimeTopic } from "./useRealtimeTopic";
import { realRealtimeClock } from "@/lib/realtime/clock";
import { isRealtimeAllowed } from "@/lib/realtime/preferences";

export interface OracleStatusState {
  data: OracleReading[];
  lastUpdated: Date | null;
  isRefreshing: boolean;
  isFixture: boolean;
  refresh: () => Promise<void>;
}

/** REST remains the initial source of truth; mapped stream updates replace one reading by coverage type. */
export function useOracleStatus(): OracleStatusState {
  const realtimeEnabled = useFeatureFlag("realtime-oracle");
  const [preferenceRevision, setPreferenceRevision] = useState(0);
  const [data, setData] = useState<OracleReading[]>(FIXTURE_ORACLE_READINGS);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFixture, setIsFixture] = useState(true);

  useEffect(() => {
    const onPreferenceChange = () => setPreferenceRevision((revision) => revision + 1);
    window.addEventListener("refract-realtime-preference-change", onPreferenceChange);
    return () =>
      window.removeEventListener("refract-realtime-preference-change", onPreferenceChange);
  }, []);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await fetchOracleStatus();
      setData(result.readings);
      setLastUpdated(new Date(realRealtimeClock.now()));
      setIsFixture(false);
    } catch {
      setData(FIXTURE_ORACLE_READINGS);
      setIsFixture(true);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = realRealtimeClock.setInterval(() => void refresh(), 60_000);
    return () => realRealtimeClock.clearInterval(timer);
  }, [refresh]);

  const streamed = useRealtimeTopic(
    REALTIME_TOPICS.oracle,
    mapOracleUpdate,
    undefined,
    realtimeEnabled && isRealtimeAllowed()
  );
  useEffect(() => {
    if (!realtimeEnabled || !isRealtimeAllowed() || !streamed) return;
    setData((current) => [
      ...current.filter((item) => item.coverageType !== streamed.coverageType),
      streamed,
    ]);
    setLastUpdated(new Date(realRealtimeClock.now()));
    setIsFixture(false);
  }, [preferenceRevision, realtimeEnabled, streamed]);

  return { data, lastUpdated, isRefreshing, isFixture, refresh };
}

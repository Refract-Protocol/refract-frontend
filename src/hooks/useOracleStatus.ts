"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchOracleStatus, type OracleReading } from "@/lib/api/oracle";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";
import { useRealtimeTopic } from "./useRealtimeTopic";

export function useOracleStatus() {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const load = useCallback(async (signal: AbortSignal) => {
    try {
      const response = await fetchOracleStatus(signal);
      setLastUpdated(new Date()); setFixture(false);
      return response.readings;
    } catch {
      setFixture(true);
      return FIXTURE_ORACLE_READINGS;
    }
  }, []);
  const { data, isStale, isLoading, updatedAt, refresh: refreshTopic } = useRealtimeTopic<OracleReading[]>("oracle_update", load);
  const [isFixture, setFixture] = useState(false);
  const [isRefreshing, setRefreshing] = useState(false);
  useEffect(() => { if (updatedAt) setLastUpdated(updatedAt); }, [updatedAt]);
  useEffect(() => { if (data && data !== FIXTURE_ORACLE_READINGS) setFixture(false); }, [data]);
  useEffect(() => {
    const timer = setInterval(() => { void refreshTopic().catch(() => setFixture(true)); }, 60_000);
    return () => clearInterval(timer);
  }, [refreshTopic]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { const value = await refreshTopic(); setLastUpdated(new Date()); return value; }
    catch { setFixture(true); return FIXTURE_ORACLE_READINGS; }
    finally { setRefreshing(false); }
  }, [refreshTopic]);
  return { data: data ?? FIXTURE_ORACLE_READINGS, loading: isLoading, isFixture, isStale, lastUpdated, isRefreshing, refresh };
}

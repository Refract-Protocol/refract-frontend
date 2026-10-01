"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOracleStatus, type OracleReading } from "@/lib/api/oracle";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";

export interface OracleStatusState {
  data: OracleReading[] | null;
  loading: boolean;
  isFixture: boolean;
  lastUpdated: Date | null;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

/**
 * Loads live oracle readings from GET /api/v1/oracle/status with automatic 60s
 * polling, pause-on-tab-hidden, and manual refresh affordance.
 */
export function useOracleStatus(pollIntervalMs = 60000): OracleStatusState {
  const [data, setData] = useState<OracleReading[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFixture, setIsFixture] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const activeControllerRef = useRef<AbortController | null>(null);

  const fetchReadings = useCallback(async (isManual = false) => {
    if (activeControllerRef.current) {
      activeControllerRef.current.abort();
    }
    const controller = new AbortController();
    activeControllerRef.current = controller;

    if (isManual) {
      setIsRefreshing(true);
    }

    try {
      const { readings } = await fetchOracleStatus(controller.signal);
      setData(readings);
      setIsFixture(false);
      setLastUpdated(new Date());
    } catch {
      if (controller.signal.aborted) return;
      // If we don't have any data yet, fall back to fixture
      setData((prev) => {
        if (!prev) {
          setIsFixture(true);
          return FIXTURE_ORACLE_READINGS;
        }
        // Gracefully retain last known good readings on subsequent poll failure
        return prev;
      });
      setLastUpdated(new Date());
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchReadings();

    const intervalId = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return; // Pause when tab hidden
      }
      fetchReadings();
    }, pollIntervalMs);

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchReadings();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      clearInterval(intervalId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (activeControllerRef.current) {
        activeControllerRef.current.abort();
      }
    };
  }, [fetchReadings, pollIntervalMs]);

  const refresh = useCallback(async () => {
    await fetchReadings(true);
  }, [fetchReadings]);

  return {
    data,
    loading,
    isFixture,
    lastUpdated,
    isRefreshing,
    refresh,
  };
}

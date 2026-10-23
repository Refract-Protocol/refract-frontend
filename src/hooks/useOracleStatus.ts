"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOracleStatus } from "@/lib/api/oracle";
import { env } from "@/lib/env";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";
import { realtimeClient } from "@/lib/realtime/client";
import {
  mergeRestReadings,
  mergeStreamReadings,
  parseOraclePayload,
  type StreamReading,
} from "@/lib/realtime/oracleMerge";

export interface OracleStatusState {
  data: StreamReading[] | null;
  loading: boolean;
  isFixture: boolean;
  lastUpdated: Date | null;
  isRefreshing: boolean;
  /** True when the realtime stream was live but dropped/went silent; data then comes from REST polling until it resumes. */
  isStale: boolean;
  refresh: () => Promise<void>;
}

export const ORACLE_TOPIC = "oracle.readings";
/** No frame for this long means the socket is dead even if it never reported closing. */
export const STREAM_STALE_MS = 90_000;
/** Coalesce bursts of frames into one state update. */
const FLUSH_MS = 250;

type StreamState = "idle" | "live" | "stale";

/**
 * Oracle readings: hydrated from GET /api/v1/oracle/status, then — when the
 * `realtime-oracle` flag is on and NEXT_PUBLIC_REALTIME_URL is set — kept fresh
 * by the `oracle.readings` stream (any frame doubles as the heartbeat).
 * Pushed readings are merged by coverage type, rejecting duplicates and
 * out-of-order `seq`/`ts`. While the stream is live REST polling pauses; on
 * disconnect or {@link STREAM_STALE_MS} of silence the hook fetches REST
 * immediately, resumes 60s polling and reports `isStale` until frames resume.
 * The stream is only joined in an effect, so server render matches REST hydration.
 */
export function useOracleStatus(pollIntervalMs = 60000): OracleStatusState {
  const flagOn = useFeatureFlag("realtime-oracle");
  const streamEnabled = flagOn && Boolean(env.NEXT_PUBLIC_REALTIME_URL);

  const [data, setData] = useState<StreamReading[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFixture, setIsFixture] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [streamState, setStreamState] = useState<StreamState>("idle");

  const dataRef = useRef<StreamReading[] | null>(null);
  const streamStateRef = useRef<StreamState>("idle");
  const activeControllerRef = useRef<AbortController | null>(null);

  const commit = useCallback((next: StreamReading[]) => {
    dataRef.current = next;
    setData(next);
    setLastUpdated(new Date());
  }, []);

  const updateStreamState = useCallback((next: StreamState) => {
    streamStateRef.current = next;
    setStreamState(next);
  }, []);

  const fetchReadings = useCallback(
    async (isManual = false) => {
      activeControllerRef.current?.abort();
      const controller = new AbortController();
      activeControllerRef.current = controller;
      if (isManual) setIsRefreshing(true);

      try {
        const { readings } = await fetchOracleStatus(controller.signal);
        if (controller.signal.aborted) return;
        setIsFixture(false);
        commit(mergeRestReadings(dataRef.current ?? [], readings));
      } catch {
        if (controller.signal.aborted) return;
        // Keep last known good readings on a later failure; only fall back to the fixture when there is nothing.
        if (!dataRef.current) {
          setIsFixture(true);
          commit(FIXTURE_ORACLE_READINGS);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [commit]
  );

  // REST: initial hydration, polling (paused while the stream is live or the tab is hidden), and fallback.
  useEffect(() => {
    void fetchReadings();
    const intervalId = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (streamStateRef.current === "live") return;
      void fetchReadings();
    }, pollIntervalMs);

    const onVisible = () => {
      if (document.visibilityState === "visible" && streamStateRef.current !== "live")
        void fetchReadings();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      activeControllerRef.current?.abort();
    };
  }, [fetchReadings, pollIntervalMs]);

  // Realtime: subscribe on mount, unsubscribe on unmount (StrictMode-safe: cleanup undoes everything).
  useEffect(() => {
    if (!streamEnabled) return;

    let buffer: StreamReading[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;

    const degrade = () => {
      if (streamStateRef.current !== "live") return;
      updateStreamState("stale");
      void fetchReadings();
    };
    const armStaleTimer = () => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(degrade, STREAM_STALE_MS);
    };
    const flush = () => {
      flushTimer = null;
      const batch = buffer;
      buffer = [];
      const merged = mergeStreamReadings(dataRef.current ?? [], batch);
      if (merged === dataRef.current) return;
      setIsFixture(false);
      commit(merged);
    };

    const unsubscribe = realtimeClient.subscribe(ORACLE_TOPIC, (payload) => {
      armStaleTimer();
      if (streamStateRef.current !== "live") {
        activeControllerRef.current?.abort();
        updateStreamState("live");
      }
      buffer.push(...parseOraclePayload(payload));
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
    });
    const unwatch = realtimeClient.onConnectionChange((connected) => {
      if (!connected) degrade();
    });

    return () => {
      unsubscribe();
      unwatch();
      if (flushTimer) clearTimeout(flushTimer);
      if (staleTimer) clearTimeout(staleTimer);
      updateStreamState("idle");
    };
  }, [streamEnabled, fetchReadings, commit, updateStreamState]);

  const refresh = useCallback(() => fetchReadings(true), [fetchReadings]);

  return {
    data,
    loading,
    isFixture,
    lastUpdated,
    isRefreshing,
    isStale: streamState === "stale",
    refresh,
  };
}

"use client";

import { useEffect, useSyncExternalStore } from "react";

import { getMetrics, sampleMetrics, subscribeMetrics } from "./metrics";

const SAMPLE_MS = 2_000;

/** Realtime data-usage totals, resampled every 2s so high-rate streams don't re-render consumers. */
export function useRealtimeMetrics() {
  useEffect(() => {
    sampleMetrics();
    const id = setInterval(sampleMetrics, SAMPLE_MS);
    return () => clearInterval(id);
  }, []);
  return useSyncExternalStore(subscribeMetrics, getMetrics, getMetrics);
}

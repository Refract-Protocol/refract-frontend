"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Runs an abortable fetch immediately and then at `intervalMs` while the tab
 * is visible. Slow requests are allowed to finish; ticks that occur while one
 * is in flight are skipped so requests can never overlap.
 */
export function usePolling(
  fetcher: (signal: AbortSignal) => Promise<void>,
  intervalMs: number,
  enabled = true
): { refresh: () => Promise<void> } {
  const fetcherRef = useRef(fetcher);
  const controllerRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    if (!enabled || inFlightRef.current) return inFlightRef.current ?? Promise.resolve();
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = fetcherRef.current(controller.signal).finally(() => {
      if (inFlightRef.current === request) inFlightRef.current = null;
      if (controllerRef.current === controller) controllerRef.current = null;
    });
    inFlightRef.current = request;
    return request;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void run();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, intervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      controllerRef.current?.abort();
      controllerRef.current = null;
      inFlightRef.current = null;
    };
  }, [enabled, intervalMs, run]);

  return { refresh: run };
}

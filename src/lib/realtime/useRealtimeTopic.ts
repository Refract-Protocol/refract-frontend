"use client";

import { useEffect, useRef, useState } from "react";

import { realtimeClient } from "./client";

/**
 * Subscribe to a realtime topic. Pushes are coalesced to the latest value per
 * animation frame; `paused` drops pushes (and unsubscribes) entirely.
 */
export function useRealtimeTopic<T>(
  topic: string,
  enabled = true
): { data: T | null; receivedAt: number | null } {
  const [state, setState] = useState<{ data: T | null; receivedAt: number | null }>({
    data: null,
    receivedAt: null,
  });
  const pending = useRef<T | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const unsub = realtimeClient.subscribe(topic, (payload) => {
      pending.current = payload as T;
      if (raf) return;
      const flush = () => {
        raf = 0;
        setState({ data: pending.current, receivedAt: Date.now() });
      };
      raf =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(flush)
          : (setTimeout(flush, 16) as unknown as number);
    });
    return () => {
      unsub();
      if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
    };
  }, [topic, enabled]);

  return state;
}

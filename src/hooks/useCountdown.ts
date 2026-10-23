"use client";

import { useEffect, useState } from "react";

import { now as clockNow, subscribeTick } from "@/lib/realtime/clock";

/** Default tick: once a minute, since the display never shows seconds. */
export const DEFAULT_TICK_MS = 60_000;

/**
 * Milliseconds remaining until `targetTimestamp` (ms since epoch), measured on
 * the server-corrected clock and driven by a shared ticker. `expired` is true
 * once the target is reached or was already in the past, and flips immediately
 * on a server boundary event. Remaining time is clamped to zero, and is
 * recomputed on tab resume rather than fast-forwarding missed ticks.
 */
export function useCountdown(targetTimestamp: number, tickIntervalMs: number = DEFAULT_TICK_MS) {
  const [now, setNow] = useState(() => clockNow());

  useEffect(() => {
    setNow(clockNow());
    if (targetTimestamp <= clockNow()) return;
    let unsub: (() => void) | null = null;
    const tick = () => {
      const t = clockNow();
      setNow(t);
      if (t >= targetTimestamp) unsub?.();
    };
    unsub = subscribeTick(tick, tickIntervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsub?.();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [targetTimestamp, tickIntervalMs]);

  const remainingMs = Math.max(0, targetTimestamp - now);
  return { remainingMs, expired: remainingMs === 0 };
}

"use client";

import { useEffect, useState } from "react";

/** Default tick: once a minute, since the display never shows seconds. */
export const DEFAULT_TICK_MS = 60_000;

/**
 * Milliseconds remaining until `targetTimestamp` (ms since epoch), re-evaluated
 * every `tickIntervalMs`. `expired` is true once the target is reached or was
 * already in the past. The interval is cleared on unmount and whenever the
 * target or cadence changes.
 */
export function useCountdown(targetTimestamp: number, tickIntervalMs: number = DEFAULT_TICK_MS) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (targetTimestamp <= Date.now()) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= targetTimestamp) clearInterval(id);
    }, tickIntervalMs);
    return () => clearInterval(id);
  }, [targetTimestamp, tickIntervalMs]);

  const remainingMs = Math.max(0, targetTimestamp - now);
  return { remainingMs, expired: remainingMs === 0 };
}

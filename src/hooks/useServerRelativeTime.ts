import { useCallback, useSyncExternalStore } from "react";
import {
  defaultClock,
  normalizeServerTs,
  type ClockOffsetEstimator,
} from "@/lib/realtime/clockOffset";
import { formatRelativeTime } from "@/lib/format";

/**
 * Deltas (in ms) at or below this magnitude render as "just now" regardless
 * of direction, so freshly created rows never read as "in 0 seconds" (#450).
 */
export const JUST_NOW_THRESHOLD_MS = 5_000;

/**
 * "4 minutes ago" for a server timestamp, corrected for device clock skew
 * (issue #247). Use this for every realtime-driven relative time.
 *
 * Re-renders only when the displayed text changes: offset updates and the
 * tick both feed a string snapshot, and React skips equal snapshots.
 */
export function formatServerRelativeTime(
  serverTs: number,
  clock: ClockOffsetEstimator = defaultClock
): string {
  const normalized = normalizeServerTs(serverTs, clock);
  if (Math.abs(normalized - clock.now()) <= JUST_NOW_THRESHOLD_MS) {
    return "just now";
  }
  return formatRelativeTime(normalized);
}

export function useServerRelativeTime(
  serverTs: number | null | undefined,
  { tickMs = 15_000, clock = defaultClock }: { tickMs?: number; clock?: ClockOffsetEstimator } = {}
): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const unsubscribe = clock.subscribe(onChange);
      const timer = setInterval(onChange, tickMs);
      return () => {
        unsubscribe();
        clearInterval(timer);
      };
    },
    [clock, tickMs]
  );
  const getSnapshot = () => (serverTs == null ? null : formatServerRelativeTime(serverTs, clock));
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

import { useCallback, useSyncExternalStore } from "react";
import {
  defaultClock,
  normalizeServerTs,
  type ClockOffsetEstimator,
} from "@/lib/realtime/clockOffset";
import { formatRelativeTime } from "@/lib/format";

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
  return formatRelativeTime(normalizeServerTs(serverTs, clock));
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

"use client";

import { useCountdown, DEFAULT_TICK_MS } from "@/hooks/useCountdown";
import { formatDuration, formatFullDateTime } from "@/lib/format";

interface LiveCountdownProps {
  /** Target moment, ms since epoch. */
  target: number;
  /** Re-render cadence; defaults to once a minute. */
  tickIntervalMs?: number;
  /** Shown instead of a negative countdown once the target has passed, e.g. "Unlocked". */
  expiredLabel?: string;
  /** Opt in to polite screen-reader announcements on each tick; off by default to avoid constant interruption. */
  announce?: boolean;
  className?: string;
}

/**
 * Ticking "3 days, 4 hours remaining" display. The ticking state lives in
 * this leaf so parents don't re-render each tick. The full-precision date is
 * always available via `title` and visually-hidden text.
 */
export function LiveCountdown({
  target,
  tickIntervalMs = DEFAULT_TICK_MS,
  expiredLabel = "Expired",
  announce = false,
  className,
}: LiveCountdownProps) {
  const { remainingMs, expired } = useCountdown(target, tickIntervalMs);
  const full = formatFullDateTime(target);

  return (
    <time
      dateTime={new Date(target).toISOString()}
      title={full}
      aria-live={announce ? "polite" : "off"}
      className={className}
    >
      {expired ? expiredLabel : `${formatDuration(remainingMs)} remaining`}
      <span className="sr-only"> ({full})</span>
    </time>
  );
}

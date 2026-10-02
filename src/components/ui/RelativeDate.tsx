import { formatFullDateTime, formatRelativeFromNow, formatShortDate } from "@/lib/format";

interface RelativeDateProps {
  /** Target moment, ms since epoch. */
  target: number;
  /** Hide the "(in 3 days)" suffix and show only the formatted date. */
  hideRelative?: boolean;
  className?: string;
}

/** Static formatted date plus relative description, e.g. "Oct 5, 2026 (in 3 days)". Not ticking. */
export function RelativeDate({ target, hideRelative = false, className }: RelativeDateProps) {
  return (
    <time dateTime={new Date(target).toISOString()} title={formatFullDateTime(target)} className={className}>
      {formatShortDate(target)}
      {!hideRelative && ` (${formatRelativeFromNow(target)})`}
    </time>
  );
}

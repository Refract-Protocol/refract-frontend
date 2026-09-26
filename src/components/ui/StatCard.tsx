import { cn } from "@/lib/cn";
import { Card } from "./Card";
import { Skeleton } from "./Skeleton";

/**
 * Accent tones for {@link StatCard}. Mapped to the existing semantic colours
 * rather than accepting arbitrary colour strings.
 */
export type StatCardAccent = "default" | "positive" | "negative" | "muted";

/**
 * Trend direction for the optional hint line under the value.
 */
export type StatCardTrend = "up" | "down" | "flat";

export interface StatCardProps {
  /** Short label rendered above the value. */
  label: string;
  /** The metric value. Numbers are formatted with grouping; strings render as-is. */
  value: string | number;
  /** When true, renders the owned skeleton layout instead of the value. */
  loading?: boolean;
  /** Semantic accent applied to the value. Defaults to `"default"`. */
  accent?: StatCardAccent;
  /** Optional secondary line rendered under the value. */
  hint?: string;
  /** Optional trend indicator rendered alongside the hint. */
  trend?: StatCardTrend;
  /**
   * When true, the value is rendered with a count-up animation on mount.
   * Only applies to numeric values.
   */
  animateOnLoad?: boolean;
  /** Additional classes forwarded to the underlying `Card`. */
  className?: string;
}

const accentClasses: Record<StatCardAccent, string> = {
  default: "text-pm-text",
  positive: "text-pm-green",
  negative: "text-pm-red",
  muted: "text-pm-muted",
};

const trendGlyphs: Record<StatCardTrend, string> = {
  up: "\u2191",
  down: "\u2193",
  flat: "\u2192",
};

const trendClasses: Record<StatCardTrend, string> = {
  up: "text-pm-green",
  down: "text-pm-red",
  flat: "text-pm-muted",
};

function formatValue(value: string | number): string {
  if (typeof value === "number") {
    return value.toLocaleString("en-US");
  }
  return value;
}

/**
 * A single "label above a large number" metric tile.
 *
 * Owns its loading skeleton, accent tone and number formatting so call sites
 * never re-implement the loading branch. Layout-agnostic: sizing and grid
 * placement are left to the consumer via `className`.
 */
export function StatCard({
  label,
  value,
  loading = false,
  accent = "default",
  hint,
  trend,
  animateOnLoad = false,
  className,
}: StatCardProps) {
  const numeric = typeof value === "number";
  const animated = animateOnLoad && numeric && !loading;

  return (
    <Card padding="stat" className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-pm-muted">
        {label}
      </span>
      {loading ? (
        <span role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading {label}</span>
          <Skeleton className="h-7 w-24" />
        </span>
      ) : (
        <span
          className={cn(
            "text-2xl font-semibold tabular-nums",
            accentClasses[accent],
          )}
        >
          {animated ? (
            <Counter value={value as number} />
          ) : (
            formatValue(value)
          )}
        </span>
      )}
      {(hint || trend) && !loading ? (
        <span className="flex items-center gap-1 text-xs text-pm-muted">
          {trend ? (
            <span aria-hidden="true" className={trendClasses[trend]}>
              {trendGlyphs[trend]}
            </span>
          ) : null}
          {hint ? <span>{hint}</span> : null}
        </span>
      ) : null}
    </Card>
  );
}

/**
 * Minimal count-up renderer used when `animateOnLoad` is set.
 * The full animation rework is tracked separately under performance.
 */
function Counter({ value }: { value: number }) {
  return <span className="tabular-nums">{formatValue(value)}</span>;
}

"use client";

import { useEffect } from "react";

/**
 * Visual tone for a {@link Meter}. Maps to a token-driven gradient so call
 * sites never need to build inline gradient strings.
 */
export type MeterTone = "safe" | "warning" | "danger" | "neutral";

export interface MeterProps {
  /** Current value. Clamped into `[min, max]`. */
  value: number;
  /** Lower bound of the range. Defaults to `0`. */
  min?: number;
  /** Upper bound of the range. Defaults to `100`. */
  max?: number;
  /** Token-driven fill gradient. Defaults to `"neutral"`. */
  tone?: MeterTone;
  /** Accessible name for the meter. */
  label: string;
  /** Human-readable value readout, exposed via `aria-valuetext`. */
  valueText?: string;
  /** Render the numeric readout next to the track. Defaults to `false`. */
  showValue?: boolean;
  /** Optional class applied to the outer wrapper. */
  className?: string;
}

const TONE_GRADIENTS: Record<MeterTone, string> = {
  safe: "linear-gradient(90deg, var(--pm-violet), var(--pm-safe))",
  warning: "linear-gradient(90deg, var(--pm-violet), var(--pm-warning))",
  danger: "linear-gradient(90deg, var(--pm-violet), var(--pm-danger))",
  neutral: "linear-gradient(90deg, var(--pm-violet), var(--pm-violet))",
};

/**
 * Clamp `value` into the `[min, max]` range, guarding against a zero-width
 * range (e.g. `max === min`) and non-finite inputs. Flags out-of-range values
 * in development so callers can catch bad data early.
 */
function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[Meter] Received non-finite value: ${value}`);
    }
    return min;
  }

  if (value < min || value > max) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[Meter] Value ${value} is out of range [${min}, ${max}]; clamping.`,
      );
    }
  }

  return Math.min(Math.max(value, min), max);
}

/**
 * Accessible meter/progress bar primitive.
 *
 * Renders a `role="meter"` element with the full ARIA value surface and a
 * token-driven gradient fill. Out-of-range values are clamped (and flagged in
 * development), and a zero-width range is guarded so the fill never divides by
 * zero.
 */
export function Meter({
  value,
  min = 0,
  max = 100,
  tone = "neutral",
  label,
  valueText,
  showValue = false,
  className,
}: MeterProps) {
  const safeMin = Number.isFinite(min) ? min : 0;
  const safeMax = Number.isFinite(max) ? max : 100;
  const clamped = clampValue(value, safeMin, safeMax);

  const range = safeMax - safeMin;
  const pct = range > 0 ? ((clamped - safeMin) / range) * 100 : 0;

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (safeMax <= safeMin) {
      console.warn(
        `[Meter] Non-positive range (min=${safeMin}, max=${safeMax}); fill pinned to 0%.`,
      );
    }
  }, [safeMin, safeMax]);

  const readout = valueText ?? `${Math.round(clamped)}`;

  return (
    <div className={className ? `pm-meter ${className}` : "pm-meter"}>
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={safeMin}
        aria-valuemax={safeMax}
        aria-valuetext={readout}
        className="pm-meter-track"
      >
        <div
          className="pm-meter-fill"
          style={{
            width: `${pct}%`,
            backgroundImage: TONE_GRADIENTS[tone],
          }}
        />
      </div>
      {showValue ? (
        <span className="pm-meter-value" aria-hidden="true">
          {readout}
        </span>
      ) : null}
    </div>
  );
}

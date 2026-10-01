"use client";

import { useEffect, useMemo, useRef } from "react";

import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

export interface ChartDonutSegment {
  label: string;
  value: number;
  color: string;
}

export interface ChartDonutProps {
  segments: ChartDonutSegment[];
  /** Diameter of the rendered chart in CSS pixels. */
  size?: number;
  /** Thickness of the donut ring in CSS pixels. */
  thickness?: number;
  /** Accessible summary announced for the chart as a whole. */
  ariaLabel?: string;
  className?: string;
}

const DEFAULT_SIZE = 160;
const DEFAULT_THICKNESS = 28;

/**
 * Normalizes raw segment values into fractions of a full circle.
 *
 * - Values summing to less than 100% leave a visible gap (the remainder is
 *   simply not drawn).
 * - Values summing to more than 100% are normalized so the ring never
 *   over-draws itself.
 * - Non-finite or negative values are treated as zero.
 */
export function computeSegmentFractions(
  segments: ChartDonutSegment[],
): number[] {
  const safeValues = segments.map((segment) =>
    Number.isFinite(segment.value) && segment.value > 0 ? segment.value : 0,
  );
  const total = safeValues.reduce((sum, value) => sum + value, 0);

  if (total <= 0) {
    return safeValues.map(() => 0);
  }

  // If the total exceeds 100 we normalize; otherwise we keep the raw
  // proportions so a sub-100% total leaves a visible gap.
  const denominator = total > 100 ? total : 100;

  return safeValues.map((value) => value / denominator);
}

function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/**
 * Accessible donut chart.
 *
 * Renders the ring on a device-pixel-ratio-aware canvas and exposes the
 * underlying data as a visually-hidden table so screen-reader and
 * no-canvas users still get the full breakdown.
 */
export function ChartDonut({
  segments,
  size = DEFAULT_SIZE,
  thickness = DEFAULT_THICKNESS,
  ariaLabel,
  className,
}: ChartDonutProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  const fractions = useMemo(() => computeSegmentFractions(segments), [segments]);

  const summary =
    ariaLabel ??
    `Donut chart: ${segments
      .map((segment, index) => `${segment.label} ${formatPercent(fractions[index] ?? 0)}`)
      .join(", ")}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const dpr =
      typeof window !== "undefined" && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size, size);

    const center = size / 2;
    const radius = center - thickness / 2;
    const startAngle = -Math.PI / 2;

    let angle = startAngle;

    segments.forEach((segment, index) => {
      const fraction = fractions[index] ?? 0;
      if (fraction <= 0) {
        return;
      }

      const endAngle = angle + fraction * Math.PI * 2;

      context.beginPath();
      context.arc(center, center, radius, angle, endAngle);
      context.strokeStyle = segment.color;
      context.lineWidth = thickness;
      context.stroke();

      angle = endAngle;
    });
  }, [segments, fractions, size, thickness, prefersReducedMotion]);

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={summary}
        width={size}
        height={size}
      />
      <table className="sr-only">
        <caption>{ariaLabel ?? "Capital allocation breakdown"}</caption>
        <thead>
          <tr>
            <th scope="col">Segment</th>
            <th scope="col">Value</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((segment, index) => (
            <tr key={`${segment.label}-${index}`}>
              <th scope="row">{segment.label}</th>
              <td>{segment.value}</td>
              <td>{formatPercent(fractions[index] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

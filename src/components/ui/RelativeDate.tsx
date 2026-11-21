"use client";

import { useServerRelativeTime } from "@/hooks/useServerRelativeTime";

const JUST_NOW_THRESHOLD_MS = 5_000;

const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

function formatRelative(target: number, now: number): string {
  const deltaMs = target - now;

  if (Math.abs(deltaMs) < JUST_NOW_THRESHOLD_MS) {
    return "just now";
  }

  let duration = deltaMs / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }

  return formatter.format(Math.round(duration), "year");
}

export interface RelativeDateProps {
  target: string | number | Date;
  className?: string;
}

export function RelativeDate({ target, className }: RelativeDateProps) {
  const now = useServerRelativeTime();
  const targetMs = new Date(target).getTime();

  return (
    <time dateTime={new Date(targetMs).toISOString()} className={className}>
      {formatRelative(targetMs, now)}
    </time>
  );
}

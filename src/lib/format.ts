/** Shared number/currency formatting helpers used across pages. */

import { usePreferencesStore } from "@/lib/store/preferencesStore";

const USDC_DECIMALS = 7;

/** Converts a human USDC amount (e.g. 5000) to the integer base-unit string the backend expects (1e7 per USDC). */
export function toStroops(amount: number): string {
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS)).toString();
}

/** Converts a base-unit string (1e7 per USDC) back to a human float. */
export function fromStroops(value: string | number): number {
  return Number(value) / 10 ** USDC_DECIMALS;
}

/**
 * Resolves the locale used for display formatting. Falls back to "en-US"
 * (today's behaviour) when the store is unavailable, e.g. during SSR or
 * before the persisted preferences have hydrated.
 */
function resolveLocale(): string {
  try {
    return usePreferencesStore.getState().locale || "en-US";
  } catch {
    return "en-US";
  }
}

export function formatUsd(value: number, opts: Intl.NumberFormatOptions = {}): string {
  return value.toLocaleString(resolveLocale(), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...opts,
  });
}

export function formatCompactUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return formatUsd(value);
}

/** Renders a past timestamp (ms since epoch) as "3 days ago", "2 weeks ago", etc. */
export function formatRelativeTime(timestampMs: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestampMs) / 1000));
  const units: [string, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, secondsInUnit] of units) {
    const count = Math.floor(seconds / secondsInUnit);
    if (count >= 1) return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

/** Shared number/currency formatting helpers used across pages. */

/**
 * Number of decimal places for USDC on Stellar.
 * 1 USDC = 10^7 base units.  Exported so call sites can reference it
 * explicitly when constructing an AssetInfo, and used as the default
 * throughout this module to preserve all existing call-site behaviour.
 */
export const USDC_DECIMALS = 7;

/**
 * Converts a human-readable asset amount (e.g. 5000) to the integer
 * base-unit string the backend expects.
 *
 * @param amount   Human-readable amount (e.g. 5000.25).
 * @param decimals Number of decimal places for the asset's base unit.
 *                 Defaults to {@link USDC_DECIMALS} (7) so all existing
 *                 USDC call sites continue to work without modification.
 * @returns        Integer base-unit string (e.g. "50002500000").
 */
export function toStroops(amount: number, decimals: number = USDC_DECIMALS): string {
  // Use BigInt arithmetic to avoid floating-point precision loss at the final
  // integer boundary.  Math.round handles sub-stroop residuals consistently.
  return BigInt(Math.round(amount * 10 ** decimals)).toString();
}

/**
 * Converts an integer base-unit value back to a human-readable float.
 *
 * @param value    Base-unit amount as a string or number.
 * @param decimals Number of decimal places for the asset's base unit.
 *                 Defaults to {@link USDC_DECIMALS} (7) so all existing
 *                 USDC call sites continue to work without modification.
 * @returns        Human-readable float (e.g. 5000.25).
 */
export function fromStroops(value: string | number, decimals: number = USDC_DECIMALS): number {
  return Number(value) / 10 ** decimals;
}

export function formatUsd(value: number, opts: Intl.NumberFormatOptions = {}): string {
  return value.toLocaleString("en-US", {
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

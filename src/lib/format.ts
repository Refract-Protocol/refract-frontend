/** Shared number/currency formatting helpers used across pages. */

const USDC_DECIMALS = 7;

/** Converts a human USDC amount (e.g. 5000) to the integer base-unit string the backend expects (1e7 per USDC). */
export function toStroops(amount: number): string {
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS)).toString();
}

/** Converts a base-unit string (1e7 per USDC) back to a human float. */
export function fromStroops(value: string | number): number {
  return Number(value) / 10 ** USDC_DECIMALS;
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

/**
 * Parses a user-entered amount string into a finite, non-negative number.
 * Returns `null` for empty, non-numeric, or negative input so callers can
 * render a dash instead of `$NaN`.
 */
export function parseAmount(input: string | null | undefined): number | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Converts an annual percentage yield expressed in basis points (1 bps = 0.01%)
 * into a decimal rate (e.g. 890 bps -> 0.089). Kept in one documented helper so
 * call sites never inline `/10000`.
 */
export function apyBpsToRate(apyBps: number): number {
  return apyBps / 10_000;
}

/**
 * Estimates the simple (non-compounded) yield earned over `days` on `amount`
 * at an annual rate given in basis points. Uses a 365-day year so a 30-day
 * estimate is `amount * rate * 30/365`, matching the label rather than a
 * calendar-month approximation. Returns `null` when the inputs are unusable
 * (unparseable amount or non-finite APY) so the UI can show a dash.
 */
export function estimateYield(
  amount: number | null,
  apyBps: number,
  days: number,
): number | null {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return null;
  if (!Number.isFinite(apyBps) || !Number.isFinite(days) || days < 0) return null;
  return amount * apyBpsToRate(apyBps) * (days / 365);
}

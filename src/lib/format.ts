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

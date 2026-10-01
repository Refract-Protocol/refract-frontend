/**
 * Pure helpers for estimating pool yield.
 *
 * APY is expressed in basis points (bps) throughout the API layer
 * (see `src/lib/api/pool.ts`), so all conversions from bps to a decimal
 * rate live here rather than being inlined as `/ 10000` at call sites.
 *
 * These estimates are illustrative only: they assume the current APY holds
 * for the whole period and do not model payout risk, fees, or compounding
 * beyond the simple per-period accrual described below.
 */

/** Number of basis points in one whole unit (100%). */
export const BPS_DENOMINATOR = 10_000;

/** Days in a year, used to convert an annual rate to a daily rate. */
export const DAYS_PER_YEAR = 365;

/**
 * Convert an APY expressed in basis points to a decimal rate.
 *
 * `890` bps -> `0.089`. Non-finite input yields `0` so callers never
 * propagate `NaN` into currency formatting.
 */
export function apyBpsToRate(apyBps: number | null | undefined): number {
  if (apyBps == null || !Number.isFinite(apyBps)) return 0;
  return apyBps / BPS_DENOMINATOR;
}

/**
 * Estimate the yield earned over `days` on `amount` at `apyBps`.
 *
 * The arithmetic matches the label: a 30-day estimate uses `30 / 365` of the
 * annual rate (not `1 / 12`), so the displayed figure is a true 30-day
 * projection. Returns `null` when the estimate cannot be computed honestly
 * (unparseable/negative amount, missing APY, or non-positive day count) so
 * the UI can render a dash instead of `$NaN`.
 */
export function estimateYield(
  amount: number | null | undefined,
  apyBps: number | null | undefined,
  days: number,
): number | null {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return null;
  if (apyBps == null || !Number.isFinite(apyBps)) return null;
  if (!Number.isFinite(days) || days <= 0) return null;

  const rate = apyBpsToRate(apyBps);
  return amount * rate * (days / DAYS_PER_YEAR);
}

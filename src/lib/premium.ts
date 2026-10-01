/**
 * Premium calculation and comparison utilities for Refract policies.
 */

/**
 * Calculates policy premium based on coverage amount (USDC), annual base rate percentage,
 * and duration in days.
 * Formula: amount * (baseRatePct / 100) * (durationDays / 365)
 */
export function calculatePremium(
  coverageAmount: number | string,
  baseRatePct: number,
  durationDays: number
): number {
  const amount = typeof coverageAmount === "string" ? parseFloat(coverageAmount) || 0 : coverageAmount || 0;
  if (amount <= 0 || baseRatePct <= 0 || durationDays <= 0) return 0;
  const annualRate = baseRatePct / 100;
  return amount * annualRate * (durationDays / 365);
}

/**
 * Validates and updates coverage type selection between a min (default 2) and max (default 4) count.
 */
export function toggleCoverageSelection(
  currentSelected: number[],
  typeId: number,
  minLimit = 2,
  maxLimit = 4
): { selected: number[]; error?: string } {
  const isSelected = currentSelected.includes(typeId);
  if (isSelected) {
    if (currentSelected.length <= minLimit) {
      return {
        selected: currentSelected,
        error: `Select at least ${minLimit} coverage types to compare`,
      };
    }
    return {
      selected: currentSelected.filter((id) => id !== typeId),
    };
  } else {
    if (currentSelected.length >= maxLimit) {
      return {
        selected: currentSelected,
        error: `You can compare up to ${maxLimit} coverage types at once`,
      };
    }
    return {
      selected: [...currentSelected, typeId],
    };
  }
}

/**
 * Calculates effective max coverage for a coverage type given chain bounds.
 */
export function getEffectiveMaxCoverage(
  typeMaxCoverage: number,
  chainMaxCoverage: number | null | undefined
): number {
  if (chainMaxCoverage !== null && chainMaxCoverage !== undefined && chainMaxCoverage > 0) {
    return Math.min(typeMaxCoverage, chainMaxCoverage);
  }
  return typeMaxCoverage;
}

/**
 * Calculates effective min coverage given chain bounds (minimum $100).
 */
export function getEffectiveMinCoverage(chainMinCoverage: number | null | undefined): number {
  return Math.max(100, chainMinCoverage ?? 0);
}

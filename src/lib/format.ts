// Shared money formatting helpers.
//
// Currency values coming from the API are base-unit strings (see
// `src/lib/api/policies.ts` and `src/lib/api/pool.ts`). USDC uses 7 decimals,
// so every base-unit -> human conversion must go through `fromStroops`.

export const USDC_DECIMALS = 7;

/** Scale factor between a USDC base unit and one whole USDC. */
export const USDC_BASE_UNIT = 10 ** USDC_DECIMALS;

/**
 * Convert a USDC base-unit value (string or number) into whole USDC.
 *
 * Uses `BigInt` for string input so very large base-unit strings keep full
 * precision; number input is divided directly (numbers are already floats).
 */
export function fromStroops(value: string | number | bigint): number {
  if (typeof value === 'bigint') {
    return Number(value) / USDC_BASE_UNIT;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return 0;
    try {
      return Number(BigInt(trimmed)) / USDC_BASE_UNIT;
    } catch {
      return Number(trimmed) / USDC_BASE_UNIT;
    }
  }
  return value / USDC_BASE_UNIT;
}

/**
 * Convert a whole-USDC amount into its exact base-unit string.
 *
 * This is the inverse of `fromStroops` and is used by the pre-signature
 * review step to show the precise on-chain amount that will be submitted.
 * Uses `BigInt` so the conversion is exact for whole and fractional USDC
 * values (fractions are truncated to the 7 supported decimals).
 */
export function toStroops(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const whole = Math.floor(abs);
  const fraction = Math.round((abs - whole) * USDC_BASE_UNIT);
  return `${sign}${BigInt(whole) * BigInt(USDC_BASE_UNIT) + BigInt(fraction)}`;
}

/** Format a whole-USDC amount as a USD string with thousands separators. */
export function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a whole-USDC amount as a compact USD string (e.g. `$1.2M`).
 *
 * Handles values under 1,000 (rendered with cents), negatives, and uses
 * consistent thousands separators for the sub-million range.
 */
export function formatCompactUsd(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${abs.toLocaleString('en-US', {
      maximumFractionDigits: 0,
    })}`;
  }
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a share price. Share prices are quoted to 4 decimal places, which is
 * the precision the pool contract reports and the precision the UI relies on.
 */
export function formatSharePrice(value: number): string {
  return `$${value.toFixed(4)}`;
}

/**
 * Format a whole-USDC amount as a plain USD string with thousands separators
 * (no leading `$`). Kept for callers that render the currency symbol
 * separately.
 */
export function formatUsdc(amount: number): string {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

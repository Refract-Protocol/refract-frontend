/**
 * Parsing and normalisation for the coverage range query params (`min`/`max`)
 * on the cover page URL.
 *
 * Rules:
 * - Non-numeric or negative values are rejected and replaced with defaults.
 * - When `min > max`, the two values are swapped (rather than discarded) so a
 *   hand-edited URL still produces a sensible, non-empty range.
 * - The returned `search` string is the normalised query so callers can write
 *   it back to the URL and a refresh does not re-trigger the invalid state.
 */

export interface CoverageBoundsDefaults {
  min: number;
  max: number;
}

export interface NormalisedCoverageBounds {
  min: number;
  max: number;
  /** True when the incoming params differed from the normalised result. */
  changed: boolean;
  /** Normalised query string (without leading `?`), preserving other params. */
  search: string;
}

function parseBound(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

/**
 * Reads `min`/`max` from a query string, validates them, and returns
 * normalised bounds plus a normalised query string.
 */
export function normaliseCoverageBounds(
  search: string,
  defaults: CoverageBoundsDefaults,
): NormalisedCoverageBounds {
  const params = new URLSearchParams(search);
  const rawMin = params.get("min");
  const rawMax = params.get("max");

  let min = parseBound(rawMin, defaults.min);
  let max = parseBound(rawMax, defaults.max);

  if (min > max) {
    [min, max] = [max, min];
  }

  const changed =
    rawMin !== String(min) || rawMax !== String(max);

  params.set("min", String(min));
  params.set("max", String(max));

  return { min, max, changed, search: params.toString() };
}

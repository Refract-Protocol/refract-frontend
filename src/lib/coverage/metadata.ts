/**
 * Shared coverage metadata.
 *
 * Coverage types are supplied by the backend as plain numbers, so every
 * lookup here is *total*: unknown, negative or fractional ids resolve to a
 * documented neutral fallback instead of `undefined`. This keeps inline
 * styles and icon spans from rendering blank or crashing when the backend
 * drifts ahead of the frontend.
 */

export interface CoverageMeta {
  /** Neutral icon used when the id is unknown. */
  icon: string;
  /** Neutral colour used when the id is unknown. */
  color: string;
  /** Human readable name used when the backend does not supply one. */
  name: string;
}

/**
 * Neutral fallback for unknown coverage ids. Deliberately grey and
 * icon-less so it never implies a risk level the policy does not have.
 */
export const UNKNOWN_COVERAGE: CoverageMeta = {
  icon: '\u25CB',
  color: '#9CA3AF',
  name: 'Unknown coverage',
};

/**
 * Known coverage metadata keyed by id. A `Record` (rather than a positional
 * array) is used because the key is externally supplied.
 */
export const COVERAGE_META: Record<number, CoverageMeta> = {
  0: { icon: '\u{1F6E1}', color: '#3B82F6', name: 'Basic' },
  1: { icon: '\u{1F512}', color: '#10B981', name: 'Standard' },
  2: { icon: '\u{1F6E1}\uFE0F', color: '#F59E0B', name: 'Premium' },
  3: { icon: '\u2B50', color: '#8B5CF6', name: 'Elite' },
  4: { icon: '\u{1F451}', color: '#EF4444', name: 'Platinum' },
};

/**
 * Dev-mode warning for out-of-range ids so backend drift is noticed early.
 * No-op outside development and never throws.
 */
export function warnUnknownCoverage(id: number, context = 'coverage'): void {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(`[${context}] Unknown coverage type id: ${String(id)}`);
  }
}

/**
 * Total lookup for coverage metadata. Returns the neutral fallback for
 * unknown, negative or fractional ids.
 */
export function getCoverageMeta(id: number | null | undefined): CoverageMeta {
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    warnUnknownCoverage(id as number);
    return UNKNOWN_COVERAGE;
  }
  const meta = COVERAGE_META[id];
  if (!meta) {
    warnUnknownCoverage(id);
    return UNKNOWN_COVERAGE;
  }
  return meta;
}

/** Total lookup for the coverage icon. */
export function getCoverageIcon(id: number | null | undefined): string {
  return getCoverageMeta(id).icon;
}

/** Total lookup for the coverage colour. */
export function getCoverageColor(id: number | null | undefined): string {
  return getCoverageMeta(id).color;
}

/**
 * Total lookup for the coverage name. Prefers the backend-supplied name so
 * unknown ids still render something meaningful.
 */
export function getCoverageName(
  id: number | null | undefined,
  backendName?: string | null,
): string {
  if (backendName) return backendName;
  return getCoverageMeta(id).name;
}

/**
 * Risk metadata. Unknown risk levels fall back to a defined colour and heat
 * value so `undefined` never reaches CSS.
 */
export interface RiskMeta {
  color: string;
  heat: number;
}

export const UNKNOWN_RISK: RiskMeta = { color: '#9CA3AF', heat: 0 };

export const RISK_META: Record<number, RiskMeta> = {
  0: { color: '#10B981', heat: 20 },
  1: { color: '#84CC16', heat: 40 },
  2: { color: '#F59E0B', heat: 60 },
  3: { color: '#F97316', heat: 80 },
  4: { color: '#EF4444', heat: 100 },
};

/** Total lookup for risk metadata. */
export function getRiskMeta(level: number | null | undefined): RiskMeta {
  if (typeof level !== 'number' || !Number.isInteger(level)) {
    return UNKNOWN_RISK;
  }
  return RISK_META[level] ?? UNKNOWN_RISK;
}

/** Total lookup for a risk colour. */
export function getRiskColor(level: number | null | undefined): string {
  return getRiskMeta(level).color;
}

/** Total lookup for a risk heat value (0-100). */
export function getRiskHeat(level: number | null | undefined): number {
  return getRiskMeta(level).heat;
}

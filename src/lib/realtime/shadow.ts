/**
 * Realtime shadow mode (issue #221).
 *
 * Shadow mode taps the same validated realtime message stream the merge layer
 * consumes, but never feeds realtime values into rendered state. Instead it
 * compares each realtime frame against the last known polled REST value and
 * records match/mismatch statistics for the observability module.
 *
 * Comparisons are pure functions over normalized values so they are easy to
 * test and never trigger extra network calls.
 */

export type ShadowTopic = 'oracle' | 'claim' | 'pool';

/**
 * Documented tolerances used by the normalized equality checks.
 *
 * - `timestampMs`: two timestamps are considered equal when they are within
 *   this many milliseconds of each other. Realtime frames and polled REST
 *   responses are produced at slightly different instants, so exact equality
 *   is not meaningful.
 * - `numericEpsilon`: relative tolerance for floating point values (prices,
 *   pool stats). Values are equal when `|a - b| <= epsilon * max(1, |a|, |b|)`.
 */
export const SHADOW_TOLERANCE = {
  timestampMs: 2_000,
  numericEpsilon: 1e-6,
} as const;

/**
 * Minimum interval between recorded comparisons per topic. High-frequency
 * oracle frames are sampled so shadow mode cannot flood logs.
 */
export const SHADOW_SAMPLE_INTERVAL_MS = 1_000;

export interface ShadowStats {
  topic: ShadowTopic;
  compared: number;
  matched: number;
  mismatched: number;
  /** matched / compared, or 0 when nothing has been compared yet. */
  matchRate: number;
  lastMismatchAt: number | null;
}

export interface ShadowDiscrepancy {
  topic: ShadowTopic;
  key: string;
  realtime: unknown;
  polled: unknown;
  at: number;
}

export interface ShadowComparisonResult {
  equal: boolean;
  /** Field-level differences, empty when `equal` is true. */
  differences: Array<{ field: string; realtime: unknown; polled: unknown }>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Normalized numeric equality with the documented relative tolerance. */
export function numbersEqual(a: unknown, b: unknown): boolean {
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return a === b;
  if (a === b) return true;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= SHADOW_TOLERANCE.numericEpsilon * scale;
}

/** Normalized timestamp equality with the documented millisecond tolerance. */
export function timestampsEqual(a: unknown, b: unknown): boolean {
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return a === b;
  return Math.abs(a - b) <= SHADOW_TOLERANCE.timestampMs;
}

function compareFields(
  realtime: Record<string, unknown>,
  polled: Record<string, unknown>,
  numericFields: readonly string[],
  timestampFields: readonly string[],
): ShadowComparisonResult {
  const differences: ShadowComparisonResult['differences'] = [];
  const fields = new Set([...Object.keys(realtime), ...Object.keys(polled)]);

  for (const field of fields) {
    const rt = realtime[field];
    const rest = polled[field];
    let equal: boolean;
    if (timestampFields.includes(field)) {
      equal = timestampsEqual(rt, rest);
    } else if (numericFields.includes(field)) {
      equal = numbersEqual(rt, rest);
    } else {
      equal = rt === rest;
    }
    if (!equal) differences.push({ field, realtime: rt, polled: rest });
  }

  return { equal: differences.length === 0, differences };
}

/** Pure comparison for oracle readings. */
export function compareOracleReading(
  realtime: Record<string, unknown>,
  polled: Record<string, unknown>,
): ShadowComparisonResult {
  return compareFields(
    realtime,
    polled,
    ['value', 'price', 'confidence'],
    ['timestamp', 'updatedAt'],
  );
}

/** Pure comparison for claim settlement frames. */
export function compareClaimSettlement(
  realtime: Record<string, unknown>,
  polled: Record<string, unknown>,
): ShadowComparisonResult {
  return compareFields(
    realtime,
    polled,
    ['amount', 'payout', 'fee'],
    ['settledAt', 'timestamp'],
  );
}

/** Pure comparison for pool stats frames. */
export function comparePoolStats(
  realtime: Record<string, unknown>,
  polled: Record<string, unknown>,
): ShadowComparisonResult {
  return compareFields(
    realtime,
    polled,
    ['tvl', 'volume24h', 'apr', 'reserve0', 'reserve1'],
    ['updatedAt', 'timestamp'],
  );
}

export function compareForTopic(
  topic: ShadowTopic,
  realtime: Record<string, unknown>,
  polled: Record<string, unknown>,
): ShadowComparisonResult {
  switch (topic) {
    case 'oracle':
      return compareOracleReading(realtime, polled);
    case 'claim':
      return compareClaimSettlement(realtime, polled);
    case 'pool':
      return comparePoolStats(realtime, polled);
  }
}

export interface ShadowModeOptions {
  enabled: boolean;
  /** Sink for discrepancy reports; defaults to console.warn. */
  onDiscrepancy?: (discrepancy: ShadowDiscrepancy) => void;
  /** Clock injection for deterministic tests. */
  now?: () => number;
}

/**
 * Shadow mode recorder. It never returns realtime values to callers, so it
 * cannot leak data into rendered state. The merge layer keeps preferring REST.
 */
export class ShadowMode {
  private readonly enabled: boolean;
  private readonly onDiscrepancy: (discrepancy: ShadowDiscrepancy) => void;
  private readonly now: () => number;
  private readonly stats = new Map<ShadowTopic, ShadowStats>();
  private readonly lastComparedAt = new Map<ShadowTopic, number>();

  constructor(options: ShadowModeOptions) {
    this.enabled = options.enabled;
    this.onDiscrepancy =
      options.onDiscrepancy ??
      ((discrepancy) => {
        // eslint-disable-next-line no-console
        console.warn('[realtime:shadow] discrepancy', discrepancy);
      });
    this.now = options.now ?? (() => Date.now());
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Compare a realtime frame against the last polled REST value. Returns the
   * comparison result for diagnostics, or null when shadow mode is disabled
   * or the sample was rate-limited. Never mutates rendered state.
   */
  record(
    topic: ShadowTopic,
    key: string,
    realtime: Record<string, unknown>,
    polled: Record<string, unknown> | null | undefined,
  ): ShadowComparisonResult | null {
    if (!this.enabled || !polled) return null;

    const at = this.now();
    const last = this.lastComparedAt.get(topic);
    if (last !== undefined && at - last < SHADOW_SAMPLE_INTERVAL_MS) {
      return null;
    }
    this.lastComparedAt.set(topic, at);

    const result = compareForTopic(topic, realtime, polled);
    const stats = this.getStats(topic);
    stats.compared += 1;
    if (result.equal) {
      stats.matched += 1;
    } else {
      stats.mismatched += 1;
      stats.lastMismatchAt = at;
      this.onDiscrepancy({ topic, key, realtime, polled, at });
    }
    stats.matchRate = stats.compared === 0 ? 0 : stats.matched / stats.compared;
    return result;
  }

  getStats(topic: ShadowTopic): ShadowStats {
    let stats = this.stats.get(topic);
    if (!stats) {
      stats = {
        topic,
        compared: 0,
        matched: 0,
        mismatched: 0,
        matchRate: 0,
        lastMismatchAt: null,
      };
      this.stats.set(topic, stats);
    }
    return stats;
  }

  /** Snapshot of all topic stats for the observability module. */
  getSnapshot(): ShadowStats[] {
    return (['oracle', 'claim', 'pool'] as ShadowTopic[]).map((topic) =>
      this.getStats(topic),
    );
  }
}

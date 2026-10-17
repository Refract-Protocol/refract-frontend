/**
 * Diagnostic shadow-mode comparator for running realtime streams alongside
 * polled REST values without affecting user-visible rendered state (#221).
 */

export interface ShadowToleranceConfig {
  /** Maximum allowed relative numeric difference (default: 0.0001 = 1 bps). */
  relativeNumericTolerance: number
  /** Maximum allowed absolute numeric difference (default: 1e-6). */
  absoluteNumericTolerance: number
  /** Maximum allowed timestamp skew in milliseconds (default: 5,000ms). */
  timestampToleranceMs: number
}

export const DEFAULT_SHADOW_TOLERANCE: ShadowToleranceConfig = {
  relativeNumericTolerance: 0.0001, // 0.01% (1 basis point)
  absoluteNumericTolerance: 1e-6,
  timestampToleranceMs: 5_000,
}

export interface ShadowDiscrepancyDetail {
  field: string
  restValue: unknown
  realtimeValue: unknown
  reason: string
}

export interface ShadowComparisonReport {
  topic: string
  comparedAt: number
  matched: boolean
  discrepancies: ShadowDiscrepancyDetail[]
}

export interface ShadowTopicStats {
  topic: string
  totalComparisons: number
  matchedCount: number
  mismatchCount: number
  skippedByRateLimit: number
  matchRate: number
  lastReport: ShadowComparisonReport | null
}

export interface ShadowComparatorOptions {
  /** Whether shadow mode is enabled (default: false — off by default). */
  enabled?: boolean
  /** Numeric and timestamp tolerances for comparison. */
  tolerance?: Partial<ShadowToleranceConfig>
  /** Minimum interval in ms between comparisons for the same topic (default: 0). */
  minCompareIntervalMs?: number
  /** Maximum recent discrepancy reports retained in memory (default: 50). */
  maxDiscrepancyLogSize?: number
  /** Optional callback fired when a mismatch is detected. */
  onDiscrepancy?: (report: ShadowComparisonReport) => void
  /** Clock provider for deterministic testing. */
  nowFn?: () => number
}

const TIMESTAMP_FIELD_PATTERN = /(timestamp|updatedAt|settledAt|fetchedAt|time)$/i

/**
 * Pure comparison helper that checks normalized equality between a polled REST
 * payload and a realtime payload with configurable numeric & timestamp tolerances.
 */
export function compareShadowPayloads(
  restPayload: unknown,
  realtimePayload: unknown,
  tolerance: ShadowToleranceConfig = DEFAULT_SHADOW_TOLERANCE,
  path = 'root'
): ShadowDiscrepancyDetail[] {
  const discrepancies: ShadowDiscrepancyDetail[] = []

  if (restPayload === realtimePayload) {
    return discrepancies
  }

  // Handle numeric comparisons (including numeric strings common in Soroban/Stellar responses)
  const restNum = toFiniteNumber(restPayload)
  const rtNum = toFiniteNumber(realtimePayload)

  if (restNum !== null && rtNum !== null) {
    if (TIMESTAMP_FIELD_PATTERN.test(path)) {
      const diffMs = Math.abs(restNum - rtNum)
      if (diffMs > tolerance.timestampToleranceMs) {
        discrepancies.push({
          field: path,
          restValue: restPayload,
          realtimeValue: realtimePayload,
          reason: `Timestamp drift ${diffMs}ms exceeds tolerance ${tolerance.timestampToleranceMs}ms`,
        })
      }
      return discrepancies
    }

    const absDiff = Math.abs(restNum - rtNum)
    const denominator = Math.max(Math.abs(restNum), Math.abs(rtNum), 1e-12)
    const relDiff = absDiff / denominator

    if (
      absDiff > tolerance.absoluteNumericTolerance &&
      relDiff > tolerance.relativeNumericTolerance
    ) {
      discrepancies.push({
        field: path,
        restValue: restPayload,
        realtimeValue: realtimePayload,
        reason: `Numeric delta (abs=${absDiff.toPrecision(4)}, rel=${(relDiff * 100).toFixed(4)}%) exceeds tolerance`,
      })
    }
    return discrepancies
  }

  if (
    restPayload !== null &&
    realtimePayload !== null &&
    typeof restPayload === 'object' &&
    typeof realtimePayload === 'object' &&
    !Array.isArray(restPayload) &&
    !Array.isArray(realtimePayload)
  ) {
    const restObj = restPayload as Record<string, unknown>
    const rtObj = realtimePayload as Record<string, unknown>
    const keys = new Set([...Object.keys(restObj), ...Object.keys(rtObj)])

    for (const key of keys) {
      const subPath = path === 'root' ? key : `${path}.${key}`
      const subDiscrepancies = compareShadowPayloads(
        restObj[key],
        rtObj[key],
        tolerance,
        subPath
      )
      discrepancies.push(...subDiscrepancies)
    }
    return discrepancies
  }

  if (Array.isArray(restPayload) && Array.isArray(realtimePayload)) {
    if (restPayload.length !== realtimePayload.length) {
      discrepancies.push({
        field: `${path}.length`,
        restValue: restPayload.length,
        realtimeValue: realtimePayload.length,
        reason: 'Array length mismatch',
      })
      return discrepancies
    }
    for (let i = 0; i < restPayload.length; i++) {
      discrepancies.push(
        ...compareShadowPayloads(
          restPayload[i],
          realtimePayload[i],
          tolerance,
          `${path}[${i}]`
        )
      )
    }
    return discrepancies
  }

  discrepancies.push({
    field: path,
    restValue: restPayload,
    realtimeValue: realtimePayload,
    reason: 'Value mismatch',
  })

  return discrepancies
}

function toFiniteNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

interface InternalTopicState {
  latestRest?: unknown
  latestRealtime?: unknown
  hasRest: boolean
  hasRealtime: boolean
  lastComparedAt: number
  totalComparisons: number
  matchedCount: number
  mismatchCount: number
  skippedByRateLimit: number
  lastReport: ShadowComparisonReport | null
}

export class RealtimeShadowComparator {
  private enabled: boolean
  private readonly tolerance: ShadowToleranceConfig
  private readonly minCompareIntervalMs: number
  private readonly maxDiscrepancyLogSize: number
  private readonly onDiscrepancy?: (report: ShadowComparisonReport) => void
  private readonly nowFn: () => number

  private readonly topics = new Map<string, InternalTopicState>()
  private readonly discrepancyLog: ShadowComparisonReport[] = []

  constructor(options: ShadowComparatorOptions = {}) {
    this.enabled = options.enabled ?? false
    this.tolerance = {
      ...DEFAULT_SHADOW_TOLERANCE,
      ...options.tolerance,
    }
    this.minCompareIntervalMs = Math.max(0, options.minCompareIntervalMs ?? 0)
    this.maxDiscrepancyLogSize = Math.max(1, options.maxDiscrepancyLogSize ?? 50)
    this.onDiscrepancy = options.onDiscrepancy
    this.nowFn = options.nowFn ?? (() => Date.now())
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  /**
   * Records a polled REST value and, when shadow mode is enabled, compares it
   * against any buffered shadow realtime value. Always returns `restValue` so
   * rendered UI state is never altered by shadow mode.
   */
  resolveForRender<T>(topic: string, restValue: T, realtimeShadowValue?: T): T {
    if (!this.enabled) {
      return restValue
    }

    const state = this.getOrCreateTopicState(topic)
    state.latestRest = restValue
    state.hasRest = true

    if (realtimeShadowValue !== undefined) {
      state.latestRealtime = realtimeShadowValue
      state.hasRealtime = true
    }

    if (state.hasRest && state.hasRealtime) {
      this.evaluateTopicComparison(topic, state)
    }

    // Strictly return the REST value so shadow mode never mutates rendered UI state
    return restValue
  }

  /**
   * Records an inbound realtime frame in shadow mode and compares against the
   * latest known REST value if available.
   */
  recordRealtimeFrame(topic: string, realtimeValue: unknown): ShadowComparisonReport | null {
    if (!this.enabled) {
      return null
    }
    const state = this.getOrCreateTopicState(topic)
    state.latestRealtime = realtimeValue
    state.hasRealtime = true

    if (!state.hasRest) {
      return null
    }
    return this.evaluateTopicComparison(topic, state)
  }

  /**
   * Records a polled REST value in shadow mode and compares against the latest
   * shadow realtime value if available.
   */
  recordRestValue(topic: string, restValue: unknown): ShadowComparisonReport | null {
    if (!this.enabled) {
      return null
    }
    const state = this.getOrCreateTopicState(topic)
    state.latestRest = restValue
    state.hasRest = true

    if (!state.hasRealtime) {
      return null
    }
    return this.evaluateTopicComparison(topic, state)
  }

  getTopicStats(topic: string): ShadowTopicStats {
    const state = this.topics.get(topic)
    if (!state) {
      return {
        topic,
        totalComparisons: 0,
        matchedCount: 0,
        mismatchCount: 0,
        skippedByRateLimit: 0,
        matchRate: 1,
        lastReport: null,
      }
    }
    const matchRate =
      state.totalComparisons > 0
        ? state.matchedCount / state.totalComparisons
        : 1
    return {
      topic,
      totalComparisons: state.totalComparisons,
      matchedCount: state.matchedCount,
      mismatchCount: state.mismatchCount,
      skippedByRateLimit: state.skippedByRateLimit,
      matchRate,
      lastReport: state.lastReport,
    }
  }

  getDiscrepancyLog(): ShadowComparisonReport[] {
    return this.discrepancyLog.slice()
  }

  private evaluateTopicComparison(
    topic: string,
    state: InternalTopicState
  ): ShadowComparisonReport | null {
    const now = this.nowFn()
    if (
      this.minCompareIntervalMs > 0 &&
      state.lastComparedAt > 0 &&
      now - state.lastComparedAt < this.minCompareIntervalMs
    ) {
      state.skippedByRateLimit += 1
      return null
    }

    state.lastComparedAt = now
    const discrepancies = compareShadowPayloads(
      state.latestRest,
      state.latestRealtime,
      this.tolerance
    )
    const matched = discrepancies.length === 0
    const report: ShadowComparisonReport = {
      topic,
      comparedAt: now,
      matched,
      discrepancies,
    }

    state.totalComparisons += 1
    state.lastReport = report
    if (matched) {
      state.matchedCount += 1
    } else {
      state.mismatchCount += 1
      if (this.discrepancyLog.length >= this.maxDiscrepancyLogSize) {
        this.discrepancyLog.shift()
      }
      this.discrepancyLog.push(report)
      try {
        this.onDiscrepancy?.(report)
      } catch {
        // Never allow diagnostic callbacks to break execution
      }
    }
    return report
  }

  private getOrCreateTopicState(topic: string): InternalTopicState {
    let state = this.topics.get(topic)
    if (!state) {
      state = {
        hasRest: false,
        hasRealtime: false,
        lastComparedAt: 0,
        totalComparisons: 0,
        matchedCount: 0,
        mismatchCount: 0,
        skippedByRateLimit: 0,
        lastReport: null,
      }
      this.topics.set(topic, state)
    }
    return state
  }
}

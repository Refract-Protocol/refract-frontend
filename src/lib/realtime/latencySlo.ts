export type LatencyTopicClass =
  | 'oracle'
  | 'claims'
  | 'pool'
  | 'notifications'

export interface TopicClassSloBudget {
  topicClass: LatencyTopicClass
  p50BudgetMs: number
  p95BudgetMs: number
}

export const REALTIME_LATENCY_SLO_BUDGETS: Record<
  LatencyTopicClass,
  TopicClassSloBudget
> = {
  oracle: {
    topicClass: 'oracle',
    p50BudgetMs: 80,
    p95BudgetMs: 250,
  },
  claims: {
    topicClass: 'claims',
    p50BudgetMs: 120,
    p95BudgetMs: 350,
  },
  pool: {
    topicClass: 'pool',
    p50BudgetMs: 150,
    p95BudgetMs: 400,
  },
  notifications: {
    topicClass: 'notifications',
    p50BudgetMs: 200,
    p95BudgetMs: 500,
  },
}

export interface LatencyPipelineTrace {
  topicClass: LatencyTopicClass
  eventId: string
  /** Server or mock-server emission timestamp (optional when measuring in-process receive -> paint) */
  serverEmittedAt?: number
  /** Client wire receive timestamp */
  receivedAt: number
  /** Store merge timestamp */
  mergedAt: number
  /** Component commit / paint timestamp */
  paintedAt: number
}

export interface TopicClassLatencyStats {
  topicClass: LatencyTopicClass
  totalRecorded: number
  warmupExcluded: number
  evaluatedSampleCount: number
  p50EndToEndMs: number
  p95EndToEndMs: number
  p50InProcessMs: number
  p95InProcessMs: number
  p50BudgetMs: number
  p95BudgetMs: number
  passed: boolean
}

export interface SloAssertionReport {
  passed: boolean
  summaryText: string
  failures: string[]
  statsByClass: Partial<Record<LatencyTopicClass, TopicClassLatencyStats>>
}

export interface RealtimeLatencySloHarnessOptions {
  budgets?: Record<LatencyTopicClass, TopicClassSloBudget>
  /** Multiplier applied to budgets in noisy CI environments (default: 1.0) */
  ciBudgetMultiplier?: number
  /** Maximum clock skew allowed when computing serverEmittedAt -> paintedAt (default: 5000ms) */
  maxClockSkewMs?: number
  /** Whether to exclude the very first event per topic class after connect as warm-up (default: true) */
  excludeFirstWarmupEvent?: boolean
  /** Minimum evaluated samples required per asserted topic class to prevent silent zero-sample passes (default: 1) */
  minSamplesRequired?: number
}

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  )
  return Number(sorted[idx].toFixed(2))
}

/**
 * Records end-to-end (`serverEmittedAt -> paintedAt`) and in-process (`receivedAt -> paintedAt`)
 * realtime pipeline traces, excluding cold-start warm-up events and asserting against SLO budgets.
 */
export class RealtimeLatencySloHarness {
  private readonly budgets: Record<LatencyTopicClass, TopicClassSloBudget>
  private readonly ciMultiplier: number
  private readonly maxClockSkewMs: number
  private readonly excludeWarmup: boolean
  private readonly minSamplesRequired: number
  private readonly tracesByClass = new Map<
    LatencyTopicClass,
    LatencyPipelineTrace[]
  >()

  constructor(options: RealtimeLatencySloHarnessOptions = {}) {
    this.budgets = options.budgets ?? REALTIME_LATENCY_SLO_BUDGETS
    this.ciMultiplier = options.ciBudgetMultiplier ?? 1.0
    this.maxClockSkewMs = options.maxClockSkewMs ?? 5_000
    this.excludeWarmup = options.excludeFirstWarmupEvent ?? true
    this.minSamplesRequired = options.minSamplesRequired ?? 1
  }

  public recordTrace(trace: LatencyPipelineTrace): void {
    let bucket = this.tracesByClass.get(trace.topicClass)
    if (!bucket) {
      bucket = []
      this.tracesByClass.set(trace.topicClass, bucket)
    }
    bucket.push({ ...trace })
  }

  public evaluateSlo(
    requiredClasses?: LatencyTopicClass[],
  ): SloAssertionReport {
    const classesToCheck =
      requiredClasses ?? Array.from(this.tracesByClass.keys())
    const statsByClass: Partial<
      Record<LatencyTopicClass, TopicClassLatencyStats>
    > = {}
    const failures: string[] = []
    const lines: string[] = []

    if (classesToCheck.length === 0) {
      failures.push(
        'SLO harness self-check failed: zero topic classes were recorded or asserted',
      )
    }

    for (const topicClass of classesToCheck) {
      const rawTraces = this.tracesByClass.get(topicClass) ?? []
      const warmupExcluded =
        this.excludeWarmup && rawTraces.length > 1 ? 1 : 0
      const activeTraces =
        warmupExcluded > 0 ? rawTraces.slice(warmupExcluded) : rawTraces

      const budget = this.budgets[topicClass]
      const effectiveP50Budget = Number(
        (budget.p50BudgetMs * this.ciMultiplier).toFixed(2),
      )
      const effectiveP95Budget = Number(
        (budget.p95BudgetMs * this.ciMultiplier).toFixed(2),
      )

      if (activeTraces.length < this.minSamplesRequired) {
        failures.push(
          `[${topicClass}] Insufficient post-warmup samples: got ${activeTraces.length}, required >= ${this.minSamplesRequired}`,
        )
        continue
      }

      const inProcessSamples: number[] = []
      const endToEndSamples: number[] = []

      for (const t of activeTraces) {
        const inProc = Math.max(0, t.paintedAt - t.receivedAt)
        inProcessSamples.push(inProc)

        if (
          typeof t.serverEmittedAt === 'number' &&
          Math.abs(t.receivedAt - t.serverEmittedAt) <= this.maxClockSkewMs
        ) {
          endToEndSamples.push(Math.max(0, t.paintedAt - t.serverEmittedAt))
        } else {
          // Fall back to in-process latency when clock skew exceeds tolerance
          endToEndSamples.push(inProc)
        }
      }

      const sortedE2E = [...endToEndSamples].sort((a, b) => a - b)
      const sortedInProc = [...inProcessSamples].sort((a, b) => a - b)

      const p50E2E = computePercentile(sortedE2E, 50)
      const p95E2E = computePercentile(sortedE2E, 95)
      const p50InProc = computePercentile(sortedInProc, 50)
      const p95InProc = computePercentile(sortedInProc, 95)

      let classPassed = true
      if (p50E2E > effectiveP50Budget) {
        classPassed = false
        failures.push(
          `[${topicClass}] p50 latency ${p50E2E}ms > budget ${effectiveP50Budget}ms (+${(p50E2E - effectiveP50Budget).toFixed(2)}ms)`,
        )
      }
      if (p95E2E > effectiveP95Budget) {
        classPassed = false
        failures.push(
          `[${topicClass}] p95 latency ${p95E2E}ms > budget ${effectiveP95Budget}ms (+${(p95E2E - effectiveP95Budget).toFixed(2)}ms)`,
        )
      }

      statsByClass[topicClass] = {
        topicClass,
        totalRecorded: rawTraces.length,
        warmupExcluded,
        evaluatedSampleCount: activeTraces.length,
        p50EndToEndMs: p50E2E,
        p95EndToEndMs: p95E2E,
        p50InProcessMs: p50InProc,
        p95InProcessMs: p95InProc,
        p50BudgetMs: effectiveP50Budget,
        p95BudgetMs: effectiveP95Budget,
        passed: classPassed,
      }

      lines.push(
        `${topicClass}: p50=${p50E2E}ms (budget ${effectiveP50Budget}ms), p95=${p95E2E}ms (budget ${effectiveP95Budget}ms) [${classPassed ? 'PASS' : 'FAIL'}]`,
      )
    }

    return {
      passed: failures.length === 0,
      summaryText: lines.join('\n'),
      failures,
      statsByClass,
    }
  }
}

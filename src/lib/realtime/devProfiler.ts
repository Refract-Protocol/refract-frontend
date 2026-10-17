export interface RenderBudgetConfig {
  /** Maximum median React commit duration in ms under streaming load (default: 8ms) */
  maxMedianCommitMs?: number
  /** Maximum p95 React commit duration in ms under streaming load (default: 16ms) */
  maxP95CommitMs?: number
  /** Maximum median Interaction to Next Paint (INP) in ms (default: 200ms) */
  maxMedianInpMs?: number
  /** Fractional tolerance applied before flagging a CI regression (default: 0.15 = 15%) */
  toleranceRatio?: number
}

export interface TopicRenderSummary {
  topic: string
  commitCount: number
  medianActualDurationMs: number
  p95ActualDurationMs: number
  maxActualDurationMs: number
}

export interface RouteInpSummary {
  route: string
  sampleCount: number
  medianInpMs: number
  p95InpMs: number
  longTaskCount: number
}

export interface RenderBudgetEvaluation {
  passed: boolean
  violations: string[]
  topics: Record<string, TopicRenderSummary>
  routes: Record<string, RouteInpSummary>
}

export interface RealtimeRenderProfilerOptions {
  environment?: 'development' | 'test' | 'production'
  enabled?: boolean
  budgets?: RenderBudgetConfig
  maxSamplesPerBucket?: number
}

function computePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0
  if (sortedValues.length === 1) return sortedValues[0]
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sortedValues.length) - 1),
  )
  return Number(sortedValues[index].toFixed(2))
}

/**
 * Dev-only profiler that records React Profiler commit durations and Core Web Vitals
 * (INP / long tasks) for realtime-backed views without triggering re-renders.
 * Strict no-op in production builds.
 */
export class RealtimeRenderProfiler {
  private readonly enabled: boolean
  private readonly budgets: Required<RenderBudgetConfig>
  private readonly maxSamples: number
  private readonly topicDurations = new Map<string, number[]>()
  private readonly routeInps = new Map<string, number[]>()

  constructor(options: RealtimeRenderProfilerOptions = {}) {
    const env = options.environment ?? 'development'
    this.enabled =
      env !== 'production' && (options.enabled ?? true)
    this.budgets = {
      maxMedianCommitMs: options.budgets?.maxMedianCommitMs ?? 8,
      maxP95CommitMs: options.budgets?.maxP95CommitMs ?? 16,
      maxMedianInpMs: options.budgets?.maxMedianInpMs ?? 200,
      toleranceRatio: options.budgets?.toleranceRatio ?? 0.15,
    }
    this.maxSamples = options.maxSamplesPerBucket ?? 500
  }

  public isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Compatible with React `<Profiler onRender={...}>` callback signature.
   * Mutates internal ring buffers only — never triggers React state updates.
   */
  public recordCommit(
    _panelId: string,
    topic: string,
    _phase: 'mount' | 'update' | 'nested-update',
    actualDurationMs: number,
  ): void {
    if (!this.enabled) return
    if (!Number.isFinite(actualDurationMs) || actualDurationMs < 0) return

    const key = topic.trim()
    let list = this.topicDurations.get(key)
    if (!list) {
      list = []
      this.topicDurations.set(key, list)
    }
    list.push(actualDurationMs)
    if (list.length > this.maxSamples) {
      list.shift()
    }
  }

  /**
   * Records an Interaction to Next Paint (INP) or long-task sample attributed to a route.
   */
  public recordRouteInteraction(route: string, durationMs: number): void {
    if (!this.enabled) return
    if (!Number.isFinite(durationMs) || durationMs < 0) return

    const key = route.trim()
    let list = this.routeInps.get(key)
    if (!list) {
      list = []
      this.routeInps.set(key, list)
    }
    list.push(durationMs)
    if (list.length > this.maxSamples) {
      list.shift()
    }
  }

  public evaluateBudgets(): RenderBudgetEvaluation {
    const topics: Record<string, TopicRenderSummary> = {}
    const routes: Record<string, RouteInpSummary> = {}
    const violations: string[] = []
    const multiplier = 1 + this.budgets.toleranceRatio

    const maxAllowedMedianCommit = this.budgets.maxMedianCommitMs * multiplier
    const maxAllowedP95Commit = this.budgets.maxP95CommitMs * multiplier
    const maxAllowedMedianInp = this.budgets.maxMedianInpMs * multiplier

    for (const [topic, samples] of this.topicDurations.entries()) {
      const sorted = [...samples].sort((a, b) => a - b)
      const median = computePercentile(sorted, 50)
      const p95 = computePercentile(sorted, 95)
      const maxVal = sorted.length > 0 ? sorted[sorted.length - 1] : 0

      topics[topic] = {
        topic,
        commitCount: sorted.length,
        medianActualDurationMs: median,
        p95ActualDurationMs: p95,
        maxActualDurationMs: Number(maxVal.toFixed(2)),
      }

      if (median > maxAllowedMedianCommit) {
        violations.push(
          `Topic "${topic}" median commit duration ${median}ms exceeds budget ${maxAllowedMedianCommit.toFixed(2)}ms`,
        )
      }
      if (p95 > maxAllowedP95Commit) {
        violations.push(
          `Topic "${topic}" p95 commit duration ${p95}ms exceeds budget ${maxAllowedP95Commit.toFixed(2)}ms`,
        )
      }
    }

    for (const [route, samples] of this.routeInps.entries()) {
      const sorted = [...samples].sort((a, b) => a - b)
      const median = computePercentile(sorted, 50)
      const p95 = computePercentile(sorted, 95)
      const longTaskCount = sorted.filter((d) => d > 50).length

      routes[route] = {
        route,
        sampleCount: sorted.length,
        medianInpMs: median,
        p95InpMs: p95,
        longTaskCount,
      }

      if (median > maxAllowedMedianInp) {
        violations.push(
          `Route "${route}" median INP ${median}ms exceeds budget ${maxAllowedMedianInp.toFixed(2)}ms`,
        )
      }
    }

    return {
      passed: violations.length === 0,
      violations,
      topics,
      routes,
    }
  }

  public reset(): void {
    this.topicDurations.clear()
    this.routeInps.clear()
  }
}

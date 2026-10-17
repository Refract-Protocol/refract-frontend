import { describe, expect, it } from 'vitest'
import { RealtimeRenderProfiler } from './devProfiler'

describe('RealtimeRenderProfiler', () => {
  it('acts as a strict no-op when environment is production', () => {
    const prodProfiler = new RealtimeRenderProfiler({
      environment: 'production',
    })

    expect(prodProfiler.isEnabled()).toBe(false)
    prodProfiler.recordCommit('OraclePanel', 'oracle_update', 'update', 45)
    prodProfiler.recordRouteInteraction('/cover', 500)

    const report = prodProfiler.evaluateBudgets()
    expect(report.passed).toBe(true)
    expect(report.topics).toEqual({})
    expect(report.routes).toEqual({})
  })

  it('records React commit durations and route INP samples and detects budget regressions', () => {
    const profiler = new RealtimeRenderProfiler({
      environment: 'development',
      budgets: {
        maxMedianCommitMs: 8,
        maxP95CommitMs: 16,
        maxMedianInpMs: 200,
        toleranceRatio: 0.1, // 10% tolerance
      },
    })

    for (const d of [2.1, 3.4, 4.0, 4.2, 5.1]) {
      profiler.recordCommit('LandingStats', 'protocol.stats', 'update', d)
    }
    for (const inp of [80, 110, 140]) {
      profiler.recordRouteInteraction('/', inp)
    }

    const passingReport = profiler.evaluateBudgets()
    expect(passingReport.passed).toBe(true)
    expect(passingReport.topics['protocol.stats'].commitCount).toBe(5)
    expect(passingReport.topics['protocol.stats'].medianActualDurationMs).toBe(
      4,
    )
    expect(passingReport.routes['/'].medianInpMs).toBe(110)

    // Inject unmemoized regression on /provide
    for (const slow of [18, 22, 25, 28, 30]) {
      profiler.recordCommit('PoolFeed', 'pool:activity', 'update', slow)
    }
    for (const slowInp of [260, 290, 310]) {
      profiler.recordRouteInteraction('/provide', slowInp)
    }

    const failingReport = profiler.evaluateBudgets()
    expect(failingReport.passed).toBe(false)
    expect(failingReport.violations.length).toBeGreaterThanOrEqual(2)
    expect(failingReport.violations.join(' | ')).toContain('pool:activity')
    expect(failingReport.violations.join(' | ')).toContain('/provide')
  })
})

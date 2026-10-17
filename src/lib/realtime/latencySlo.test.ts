import { describe, expect, it } from 'vitest'
import { RealtimeLatencySloHarness } from './latencySlo'

describe('RealtimeLatencySloHarness', () => {
  it('fails the self-check when zero samples or insufficient post-warmup samples are recorded', () => {
    const emptyHarness = new RealtimeLatencySloHarness()
    const emptyReport = emptyHarness.evaluateSlo()
    expect(emptyReport.passed).toBe(false)
    expect(emptyReport.failures[0]).toContain('zero topic classes were recorded')

    const missingClassReport = emptyHarness.evaluateSlo(['oracle'])
    expect(missingClassReport.passed).toBe(false)
    expect(missingClassReport.failures[0]).toContain(
      'Insufficient post-warmup samples',
    )
  })

  it('excludes the cold-start warm-up event and evaluates steady-state p50/p95 against budgets', () => {
    const harness = new RealtimeLatencySloHarness({
      excludeFirstWarmupEvent: true,
    })

    // First event after connect has a 600ms cold-start warm-up penalty
    harness.recordTrace({
      topicClass: 'oracle',
      eventId: 'warmup-1',
      serverEmittedAt: 1_000,
      receivedAt: 1_550,
      mergedAt: 1_570,
      paintedAt: 1_600,
    })

    // Subsequent steady-state oracle updates take 35ms..60ms (< 80ms p50 budget)
    for (const [idx, latency] of [35, 42, 48, 55, 60].entries()) {
      const base = 2_000 + idx * 1_000
      harness.recordTrace({
        topicClass: 'oracle',
        eventId: `steady-${idx}`,
        serverEmittedAt: base,
        receivedAt: base + 20,
        mergedAt: base + 25,
        paintedAt: base + latency,
      })
    }

    const report = harness.evaluateSlo(['oracle'])
    expect(report.passed).toBe(true)
    expect(report.statsByClass.oracle?.warmupExcluded).toBe(1)
    expect(report.statsByClass.oracle?.evaluatedSampleCount).toBe(5)
    expect(report.statsByClass.oracle?.p50EndToEndMs).toBe(48)
    expect(report.summaryText).toContain('[PASS]')
  })

  it('produces a readable diff when p95 latency regresses and clamps excessive server clock skew', () => {
    const harness = new RealtimeLatencySloHarness({
      excludeFirstWarmupEvent: false,
      maxClockSkewMs: 2_000,
    })

    // Excessive clock skew (server clock 60s behind client) falls back to in-process receive -> paint (30ms)
    harness.recordTrace({
      topicClass: 'claims',
      eventId: 'skewed-1',
      serverEmittedAt: 10_000,
      receivedAt: 70_000,
      mergedAt: 70_010,
      paintedAt: 70_030,
    })
    expect(harness.evaluateSlo(['claims']).passed).toBe(true)

    // Inject regression exceeding 350ms p95 budget for claims
    harness.recordTrace({
      topicClass: 'claims',
      eventId: 'slow-claim-2',
      serverEmittedAt: 80_000,
      receivedAt: 80_100,
      mergedAt: 80_300,
      paintedAt: 80_480, // 480ms > 350ms
    })

    const failedReport = harness.evaluateSlo(['claims'])
    expect(failedReport.passed).toBe(false)
    expect(failedReport.failures.join(' ')).toContain(
      '[claims] p95 latency 480ms > budget 350ms (+130.00ms)',
    )
  })
})

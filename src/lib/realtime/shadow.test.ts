import { describe, expect, it } from 'vitest'
import { RealtimeShadowComparator } from './shadow'

describe('RealtimeShadowComparator (#221)', () => {
  it('accepts matching and tolerance-boundary oracle/pool values and flags out-of-tolerance discrepancies', () => {
    let now = 1_700_000_000_000
    const discrepancies: string[] = []
    const shadow = new RealtimeShadowComparator({
      enabled: true,
      nowFn: () => now,
      tolerance: {
        relativeNumericTolerance: 0.001, // 0.1%
        timestampToleranceMs: 5_000,
      },
      onDiscrepancy: (report) =>
        discrepancies.push(report.discrepancies.map((d) => d.field).join(',')),
    })

    // 1. Exact/tolerance-boundary match (price differs by 0.05% <= 0.1%, timestamp differs by 2,000ms <= 5,000ms)
    shadow.recordRestValue('oracle:XLM/USD', {
      price: '0.10000',
      updatedAt: 1_700_000_000_000,
    })
    const matchReport = shadow.recordRealtimeFrame('oracle:XLM/USD', {
      price: 0.10005,
      updatedAt: 1_700_000_002_000,
    })

    expect(matchReport?.matched).toBe(true)
    expect(shadow.getTopicStats('oracle:XLM/USD').matchedCount).toBe(1)

    // 2. Out-of-tolerance mismatch (price differs by 5%, timestamp differs by 12,000ms)
    now += 1_000
    const mismatchReport = shadow.recordRealtimeFrame('oracle:XLM/USD', {
      price: 0.105,
      updatedAt: 1_700_000_012_000,
    })

    expect(mismatchReport?.matched).toBe(false)
    expect(mismatchReport?.discrepancies.map((d) => d.field)).toEqual([
      'price',
      'updatedAt',
    ])

    const stats = shadow.getTopicStats('oracle:XLM/USD')
    expect(stats.totalComparisons).toBe(2)
    expect(stats.matchedCount).toBe(1)
    expect(stats.mismatchCount).toBe(1)
    expect(stats.matchRate).toBe(0.5)
    expect(discrepancies).toEqual(['price,updatedAt'])
  })

  it('guarantees rendered state is identical whether shadow mode is on or off', () => {
    const restClaim = { id: 'claim-7', status: 'pending', amount: '250.00' }
    const divergedRealtimeClaim = {
      id: 'claim-7',
      status: 'approved',
      amount: '999.00',
    }

    const shadowOff = new RealtimeShadowComparator({ enabled: false })
    const shadowOn = new RealtimeShadowComparator({ enabled: true })

    const renderedWhenOff = shadowOff.resolveForRender(
      'claims:GABC',
      restClaim,
      divergedRealtimeClaim
    )
    const renderedWhenOn = shadowOn.resolveForRender(
      'claims:GABC',
      restClaim,
      divergedRealtimeClaim
    )

    // Rendered output is strictly the REST value in both modes
    expect(renderedWhenOn).toEqual(renderedWhenOff)
    expect(renderedWhenOn).toBe(restClaim)

    // Shadow-off performed 0 comparisons; shadow-on recorded the discrepancy silently
    expect(shadowOff.getTopicStats('claims:GABC').totalComparisons).toBe(0)
    expect(shadowOn.getTopicStats('claims:GABC').mismatchCount).toBe(1)
  })

  it('rate-limits high-frequency comparisons per topic to avoid flooding logs', () => {
    let now = 1_700_000_000_000
    const shadow = new RealtimeShadowComparator({
      enabled: true,
      minCompareIntervalMs: 1_000,
      nowFn: () => now,
    })

    shadow.recordRestValue('oracle:XLM/USD', { price: 0.12 })

    // First frame at t=0 runs comparison
    expect(shadow.recordRealtimeFrame('oracle:XLM/USD', { price: 0.12 })?.matched).toBe(
      true
    )

    // Frames at t=200ms and t=500ms are skipped by rate limiter
    now += 200
    expect(shadow.recordRealtimeFrame('oracle:XLM/USD', { price: 0.99 })).toBeNull()
    now += 300
    expect(shadow.recordRealtimeFrame('oracle:XLM/USD', { price: 0.99 })).toBeNull()

    // Frame at t=1100ms runs comparison
    now += 600
    expect(shadow.recordRealtimeFrame('oracle:XLM/USD', { price: 0.99 })?.matched).toBe(
      false
    )

    const stats = shadow.getTopicStats('oracle:XLM/USD')
    expect(stats.totalComparisons).toBe(2)
    expect(stats.skippedByRateLimit).toBe(2)
  })
})

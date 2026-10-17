import { describe, expect, it } from 'vitest'
import { evaluateTopicFreshness } from './freshness'

describe('evaluateTopicFreshness', () => {
  it('classifies fresh, aging, and stale thresholds accurately', () => {
    const baseTime = 1_700_000_000_000

    const fresh = evaluateTopicFreshness(
      {
        topic: 'oracle_update',
        lastUpdatedAt: baseTime,
        source: 'realtime',
        transportState: 'connected',
      },
      { now: baseTime + 4_000 },
    )
    expect(fresh.level).toBe('fresh')
    expect(fresh.label).toBe('Live')
    expect(fresh.animatePulse).toBe(true)

    const aging = evaluateTopicFreshness(
      {
        topic: 'oracle_update',
        lastUpdatedAt: baseTime,
        source: 'realtime',
        transportState: 'connected',
      },
      { now: baseTime + 20_000 },
    )
    expect(aging.level).toBe('aging')
    expect(aging.label).toBe('Updated 20s ago')
    expect(aging.animatePulse).toBe(false)

    const stale = evaluateTopicFreshness(
      {
        topic: 'oracle_update',
        lastUpdatedAt: baseTime,
        source: 'realtime',
        transportState: 'connected',
      },
      { now: baseTime + 65_000 },
      'aging',
    )
    expect(stale.level).toBe('stale')
    expect(stale.label).toBe('Stale (1m ago)')
    expect(stale.shouldAnnounceToScreenReader).toBe(true)
    expect(stale.ariaLiveMode).toBe('polite')
  })

  it('honors reconnect grace period so brief reconnect churn does not flash reconnecting or stale', () => {
    const baseTime = 1_700_000_000_000

    // 2s into reconnect (< 5s grace window) -> stays 'fresh'
    const withinGrace = evaluateTopicFreshness(
      {
        topic: 'claims:updates',
        lastUpdatedAt: baseTime,
        source: 'realtime',
        transportState: 'reconnecting',
        reconnectStartedAt: baseTime + 1_000,
      },
      { now: baseTime + 3_000, reconnectGraceMs: 5_000 },
    )
    expect(withinGrace.level).toBe('fresh')
    expect(withinGrace.label).toBe('Live')

    // 7s into reconnect (>= 5s grace window) -> transitions to 'reconnecting'
    const pastGrace = evaluateTopicFreshness(
      {
        topic: 'claims:updates',
        lastUpdatedAt: baseTime,
        source: 'realtime',
        transportState: 'reconnecting',
        reconnectStartedAt: baseTime + 1_000,
      },
      { now: baseTime + 8_000, reconnectGraceMs: 5_000 },
      'fresh',
    )
    expect(pastGrace.level).toBe('reconnecting')
    expect(pastGrace.label).toBe('Reconnecting…')
    expect(pastGrace.shouldAnnounceToScreenReader).toBe(true)
  })

  it('disables pulse animation under prefersReducedMotion and renders deterministically on SSR', () => {
    const reduced = evaluateTopicFreshness(
      {
        topic: 'pool:liquidity',
        lastUpdatedAt: 10_000,
        source: 'realtime',
        transportState: 'connected',
      },
      { now: 12_000, prefersReducedMotion: true },
    )
    expect(reduced.level).toBe('fresh')
    expect(reduced.animatePulse).toBe(false)

    const ssr = evaluateTopicFreshness(
      {
        topic: 'pool:liquidity',
        lastUpdatedAt: null,
        source: 'rest_fallback',
        transportState: 'connected',
      },
      { isServer: true },
    )
    expect(ssr.level).toBe('fresh')
    expect(ssr.label).toBe('Updated via REST')
    expect(ssr.ageMs).toBeNull()
    expect(ssr.animatePulse).toBe(false)
  })
})

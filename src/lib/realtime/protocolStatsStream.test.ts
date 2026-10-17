import { describe, expect, it } from 'vitest'
import {
  formatTabularUsd,
  ProtocolStatsStreamStore,
  type ProtocolStatsViewState,
} from './protocolStatsStream'

describe('ProtocolStatsStreamStore', () => {
  it('coalesces N burst events in one animation frame into a single state commit without zero-flicker', () => {
    let frameCallback: (() => void) | null = null
    const store = new ProtocolStatsStreamStore({
      initialSeed: {
        totalValueLockedUsd: 1_250_000,
        activePoliciesCount: 340,
        cumulativePayoutsUsd: 85_000,
        reserveRatioBps: 14_500,
        updatedAt: 1_000,
      },
      scheduleFrame: (cb) => {
        frameCallback = cb
        return () => {
          frameCallback = null
        }
      },
      now: () => 2_000,
    })

    const renders: ProtocolStatsViewState[] = []
    store.subscribe((state) => renders.push(state))

    // Push 10 rapid stat deltas in a single frame
    for (let i = 1; i <= 10; i += 1) {
      store.pushRealtimeDelta({
        totalValueLockedUsd: 1_250_000 + i * 1_000,
      })
    }

    // Before animation frame fires, 0 renders have been triggered
    expect(renders).toHaveLength(0)

    // Fire animation frame -> exactly 1 render with final merged state, preserving activePoliciesCount from seed
    frameCallback!()
    expect(renders).toHaveLength(1)
    expect(renders[0].stats).toEqual({
      totalValueLockedUsd: 1_260_000,
      activePoliciesCount: 340,
      cumulativePayoutsUsd: 85_000,
      reserveRatioBps: 14_500,
      updatedAt: 2_000,
    })
    expect(renders[0].source).toBe('realtime')
    expect(renders[0].tabularFontVariant).toBe('tabular-nums')
  })

  it('transitions cleanly to REST fallback and honors prefersReducedMotion', () => {
    const store = new ProtocolStatsStreamStore({
      prefersReducedMotion: true,
      now: () => 5_000,
    })

    expect(store.getState().animateTransitions).toBe(false)

    const fallbackState = store.applyRestSnapshot(
      {
        totalValueLockedUsd: 2_500_000,
        activePoliciesCount: 512,
      },
      true,
    )

    expect(fallbackState.source).toBe('rest_fallback')
    expect(fallbackState.isFallback).toBe(true)
    expect(formatTabularUsd(fallbackState.stats.totalValueLockedUsd)).toBe(
      '$2,500,000',
    )
    store.dispose()
  })
})

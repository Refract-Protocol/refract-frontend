import { describe, expect, it } from 'vitest'
import { PoolActivityAndPresenceStream } from './poolActivityPresence'

describe('PoolActivityAndPresenceStream', () => {
  it('enforces newest-first ring-buffer bounds and strips wallet identifiers and exact position sizes', () => {
    const stream = new PoolActivityAndPresenceStream({
      maxActivityEntries: 3,
      now: () => 1_000,
    })

    stream.pushActivity({
      id: 'act-1',
      kind: 'deposit',
      poolTier: 'senior-tranche',
      amountUsd: 45_000,
      utilizationDeltaBps: -12,
      walletAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      positionSizeUsd: 450_000,
      timestamp: 1_000,
    })
    stream.pushActivity({
      id: 'act-2',
      kind: 'coverage_written',
      poolTier: 'junior-tranche',
      amountUsd: 8_500,
      utilizationDeltaBps: 18,
      timestamp: 1_010,
    })
    stream.pushActivity({
      id: 'act-3',
      kind: 'withdrawal',
      poolTier: 'senior-tranche',
      amountUsd: 150_000,
      utilizationDeltaBps: 30,
      timestamp: 1_020,
    })
    stream.pushActivity({
      id: 'act-4',
      kind: 'deposit',
      poolTier: 'senior-tranche',
      amountUsd: 500,
      utilizationDeltaBps: -2,
      timestamp: 1_030,
    })

    const feed = stream.getActivityFeed()
    expect(feed).toHaveLength(3)
    // Newest first (act-4, act-3, act-2; act-1 evicted)
    expect(feed.map((e) => e.id)).toEqual(['act-4', 'act-3', 'act-2'])
    expect(feed[1].amountBucketLabel).toBe('$100K+')

    const serialized = JSON.stringify(feed)
    expect(serialized).not.toContain(
      'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
    )
    expect(serialized).not.toContain('walletAddress')
    expect(serialized).not.toContain('positionSizeUsd')
  })

  it('expires LP presence entries client-side after presenceIdleTimeoutMs and handles no_data state', () => {
    let clock = 10_000
    const stream = new PoolActivityAndPresenceStream({
      presenceIdleTimeoutMs: 15_000,
      now: () => clock,
    })

    expect(stream.getPresenceState()).toEqual({
      status: 'no_data',
      activeProvidersCount: 0,
      label: 'Live presence unavailable',
      lastHeartbeatAt: null,
    })

    stream.recordPresenceSignal({ sessionHash: 'lp-session-1' })
    clock += 5_000
    stream.recordPresenceSignal({ sessionHash: 'lp-session-2' })

    expect(stream.getPresenceState()).toMatchObject({
      status: 'active',
      activeProvidersCount: 2,
      label: '2 providers active now',
    })

    // Advance 11s: lp-session-1 is 16s old (>= 15s timeout -> expired), lp-session-2 is 11s old (still active)
    clock += 11_000
    expect(stream.getPresenceState()).toMatchObject({
      status: 'active',
      activeProvidersCount: 1,
      label: '1 provider active now',
    })

    // Advance another 10s: both expired -> transitions to 'idle'
    clock += 10_000
    expect(stream.getPresenceState()).toMatchObject({
      status: 'idle',
      activeProvidersCount: 0,
      label: 'No providers active right now',
    })
  })
})

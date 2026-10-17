import { describe, expect, it } from 'vitest'
import {
  RealtimeAnalyticsTracker,
  type EmittedRealtimeAnalyticsEvent,
} from './realtime'

describe('RealtimeAnalyticsTracker', () => {
  it('emits coarse lifecycle events and strips wallet addresses and tokens from dimensions', () => {
    const batches: EmittedRealtimeAnalyticsEvent[][] = []
    const tracker = new RealtimeAnalyticsTracker({
      isServer: false,
      network: 'testnet',
      flagBucket: 'ga-rollout-50',
      now: () => 1_700_000_000_000,
      sink: (batch) => {
        batches.push(batch)
      },
    })

    const emitted1 = tracker.emit('realtime.connection_established', {
      transport: 'websocket',
    })
    const emitted2 = tracker.emit('realtime.topic_subscribed', {
      transport: 'websocket',
      topic: 'claims:GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      reason: 'subscribed by 0x71C7656EC7ab88b098defB751B7401B5f6d8976F with token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc',
    })

    expect(emitted1).toBe(true)
    expect(emitted2).toBe(true)
    expect(batches).toHaveLength(2)

    const serialized = JSON.stringify(batches)
    expect(serialized).not.toContain(
      'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
    )
    expect(serialized).not.toContain(
      '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
    )
    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(batches[1][0].dimensions.topicFamily).toBe('claims')
  })

  it('deduplicates repeated events within dedupeWindowMs and honors sampleRate', () => {
    let clock = 10_000
    const received: EmittedRealtimeAnalyticsEvent[] = []
    const tracker = new RealtimeAnalyticsTracker({
      isServer: false,
      dedupeWindowMs: 5_000,
      sampleRate: 0.5,
      random: () => 0.3, // <= 0.5 -> sampled in
      now: () => clock,
      sink: (batch) => received.push(...batch),
    })

    expect(
      tracker.emit('realtime.fallback_activated', {
        transport: 'polling',
        topic: 'oracle_update',
        reason: 'ws_handshake_failed',
      }),
    ).toBe(true)

    // Duplicate 2s later -> suppressed
    clock += 2_000
    expect(
      tracker.emit('realtime.fallback_activated', {
        transport: 'polling',
        topic: 'oracle_update',
        reason: 'ws_handshake_failed',
      }),
    ).toBe(false)

    // 6s later -> allowed again
    clock += 6_000
    expect(
      tracker.emit('realtime.fallback_activated', {
        transport: 'polling',
        topic: 'oracle_update',
        reason: 'ws_handshake_failed',
      }),
    ).toBe(true)

    expect(received).toHaveLength(2)
  })

  it('suppresses emission during SSR, Do-Not-Track, or Save-Data and swallows sink errors', async () => {
    const ssrTracker = new RealtimeAnalyticsTracker({ isServer: true })
    expect(
      ssrTracker.emit('realtime.connection_established', {
        transport: 'websocket',
      }),
    ).toBe(false)

    const dntTracker = new RealtimeAnalyticsTracker({
      isServer: false,
      doNotTrack: true,
    })
    expect(
      dntTracker.emit('realtime.connection_established', {
        transport: 'websocket',
      }),
    ).toBe(false)

    const throwingTracker = new RealtimeAnalyticsTracker({
      isServer: false,
      sink: () => {
        throw new Error('analytics_endpoint_down')
      },
    })
    expect(() =>
      throwingTracker.emit('realtime.unavailable', {
        transport: 'none',
        reason: 'kill_switch',
      }),
    ).not.toThrow()
    await expect(throwingTracker.flush()).resolves.toEqual([])
  })
})

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  RealtimeKillSwitchController,
  type KillSwitchTripEvent,
} from './killSwitch'

describe('RealtimeKillSwitchController (#275)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls remote flags and immediately tears down active connections when remote kill switch flips on', async () => {
    let remoteKillSwitchActive = false
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          realtimeKillSwitch: remoteKillSwitchActive,
          realtimeEnabled: !remoteKillSwitchActive,
          reason: remoteKillSwitchActive ? 'Incident #902 mitigation' : undefined,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }) as unknown as typeof fetch

    const tripEvents: KillSwitchTripEvent[] = []
    let activeSocketOpen = true
    let activeSubscriptions = ['oracle:XLM/USD', 'claims:GABC']

    const killSwitch = new RealtimeKillSwitchController({
      endpoint: '/flags.json',
      fetchFn: mockFetch,
      pollIntervalMs: 10_000,
      onTripped: (evt) => {
        tripEvents.push(evt)
        activeSocketOpen = false
        activeSubscriptions = []
      },
    })

    killSwitch.startPolling()
    await vi.advanceTimersByTimeAsync(0)
    expect(killSwitch.isTripped()).toBe(false)
    expect(activeSocketOpen).toBe(true)

    // Operator flips remote kill switch on -> next poll interval tears down socket & subscriptions
    remoteKillSwitchActive = true
    await vi.advanceTimersByTimeAsync(10_000)

    expect(killSwitch.isTripped()).toBe(true)
    expect(activeSocketOpen).toBe(false)
    expect(activeSubscriptions).toEqual([])
    expect(tripEvents).toHaveLength(1)
    expect(tripEvents[0].source).toBe('remote')
    expect(tripEvents[0].reason).toBe('Incident #902 mitigation')

    killSwitch.stopPolling()
  })

  it('auto-trips on high connection failure rate without auto-un-tripping and prevents dev override in production', () => {
    let now = 1_700_000_000_000
    const trips: KillSwitchTripEvent[] = []

    const prodKillSwitch = new RealtimeKillSwitchController({
      isProduction: true,
      autoTripFailureThreshold: 3,
      failureWindowMs: 30_000,
      nowFn: () => now,
      onTripped: (evt) => trips.push(evt),
    })

    prodKillSwitch.recordConnectionFailure()
    now += 1_000
    prodKillSwitch.recordConnectionFailure()
    expect(prodKillSwitch.isTripped()).toBe(false)

    // 3rd failure within 30s window trips the switch
    now += 1_000
    prodKillSwitch.recordConnectionFailure('Socket storm detected')
    expect(prodKillSwitch.isTripped()).toBe(true)
    expect(trips[0].source).toBe('auto_failure_rate')

    // Advancing time past failureWindowMs does NOT auto-un-trip
    now += 120_000
    expect(prodKillSwitch.isTripped()).toBe(true)

    // In production builds, devOverrideForceEnable CANNOT defeat the kill switch
    expect(prodKillSwitch.isTripped({ devOverrideForceEnable: true })).toBe(true)

    // In non-production builds, devOverrideForceEnable is permitted for local QA testing
    const devKillSwitch = new RealtimeKillSwitchController({
      isProduction: false,
      initialTripped: true,
    })
    expect(devKillSwitch.isTripped({ devOverrideForceEnable: false })).toBe(true)
    expect(devKillSwitch.isTripped({ devOverrideForceEnable: true })).toBe(false)
  })
})

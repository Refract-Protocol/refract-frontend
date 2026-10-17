import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { RealtimePageLifecycleCoordinator } from './pageLifecycle'

describe('RealtimePageLifecycleCoordinator (#272)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes pending state, relinquishes leadership, closes socket once on pagehide, and resyncs on bfcache pageshow', () => {
    const events: string[] = []

    const coordinator = new RealtimePageLifecycleCoordinator({
      callbacks: {
        flushPendingState: () => events.push('flush'),
        relinquishLeadership: () => events.push('relinquish_leader'),
        rejoinLeadership: () => events.push('rejoin_leader'),
        closeConnection: (reason) => events.push(`close:${reason}`),
        reconnectAndResync: (reason) => events.push(`resync:${reason}`),
        setStaleFromLifecycle: (stale) => events.push(`stale:${stale}`),
      },
    })

    // Enter bfcache via pagehide(persisted=true)
    coordinator.handlePageHide({ persisted: true })
    expect(coordinator.getPhase()).toBe('bfcache')
    expect(coordinator.isStaleFromLifecycle()).toBe(true)

    // Guard against double-close if pagehide/freeze fires twice
    coordinator.handlePageHide({ persisted: true })
    expect(events.filter((e) => e.startsWith('close:'))).toEqual([
      'close:bfcache_entry',
    ])
    expect(events.filter((e) => e === 'relinquish_leader')).toHaveLength(1)

    // Restore from bfcache via pageshow(persisted=true) -> forces fresh connection & resync
    coordinator.handlePageShow({ persisted: true })
    expect(coordinator.getPhase()).toBe('active')
    expect(events).toContain('rejoin_leader')
    expect(events).toContain('resync:bfcache_restore')
    expect(coordinator.isStaleFromLifecycle()).toBe(true)

    // Once resync completes, stale flag clears
    coordinator.markResyncComplete()
    expect(coordinator.isStaleFromLifecycle()).toBe(false)
  })

  it('ignores brief freezes within grace window and tears down + hands over leadership on sustained freeze', async () => {
    const closedReasons: string[] = []
    const resyncReasons: string[] = []
    let leaderRelinquishedCount = 0

    const coordinator = new RealtimePageLifecycleCoordinator({
      freezeGraceMs: 1_000,
      callbacks: {
        flushPendingState: () => {},
        relinquishLeadership: () => {
          leaderRelinquishedCount += 1
        },
        closeConnection: (reason) => closedReasons.push(reason),
        reconnectAndResync: (reason) => resyncReasons.push(reason),
      },
    })

    // 1. Brief 300ms freeze followed by resume -> does NOT close socket or relinquish leadership
    coordinator.handleFreeze()
    await vi.advanceTimersByTimeAsync(300)
    coordinator.handleResume()

    expect(closedReasons).toEqual([])
    expect(leaderRelinquishedCount).toBe(0)
    expect(coordinator.isStaleFromLifecycle()).toBe(false)

    // 2. Sustained 1,500ms freeze -> closes socket and relinquishes leadership so follower can promote
    coordinator.handleFreeze()
    await vi.advanceTimersByTimeAsync(1_500)

    expect(coordinator.getPhase()).toBe('frozen')
    expect(closedReasons).toEqual(['page_freeze'])
    expect(leaderRelinquishedCount).toBe(1)

    // Resume after sustained freeze -> triggers fresh reconnect and resync
    coordinator.handleResume()
    expect(resyncReasons).toEqual(['page_resume'])
  })

  it('reconciles visibilitychange pause/resume without fighting bfcache or freeze teardown', () => {
    const visibilityPausedStates: boolean[] = []
    const coordinator = new RealtimePageLifecycleCoordinator({
      callbacks: {
        flushPendingState: () => {},
        relinquishLeadership: () => {},
        closeConnection: () => {},
        reconnectAndResync: () => {},
        onVisibilityPausedChange: (paused) => visibilityPausedStates.push(paused),
      },
    })

    coordinator.handleVisibilityChange('hidden')
    coordinator.handleVisibilityChange('visible')
    expect(visibilityPausedStates).toEqual([true, false])

    // Once terminated via pagehide, visibilitychange is a no-op
    coordinator.handlePageHide({ persisted: false })
    coordinator.handleVisibilityChange('hidden')
    expect(visibilityPausedStates).toEqual([true, false])
  })
})

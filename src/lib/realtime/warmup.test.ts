import { describe, expect, it, vi } from 'vitest'
import { RealtimeWarmupCoordinator } from './warmup'

describe('RealtimeWarmupCoordinator', () => {
  it('reduces time-to-first-event when pre-warmed at app shell compared to a cold start', async () => {
    // 1. Cold start scenario (connect takes 220ms + first event takes 40ms = 260ms)
    let coldClock = 1_000
    const coldCoordinator = new RealtimeWarmupCoordinator({
      signals: { isServer: false },
      now: () => coldClock,
      connectTransport: async () => {
        coldClock += 220
      },
      disconnectTransport: () => {},
    })

    const detachCold = coldCoordinator.attachSubscriber()
    await Promise.resolve()
    coldClock += 40
    coldCoordinator.recordFirstEvent()
    const coldMetrics = coldCoordinator.getTimingMetrics()
    expect(coldMetrics.timeToFirstEventFromAttachMs).toBe(260)
    detachCold()

    // 2. Warmed start scenario (connect happens during idle time before hook attaches; first event arrives 40ms after attach)
    let warmClock = 1_000
    let runIdleTask: (() => void) | null = null
    const warmCoordinator = new RealtimeWarmupCoordinator({
      signals: { isServer: false },
      now: () => warmClock,
      scheduleIdle: (cb) => {
        runIdleTask = cb
        return () => {
          runIdleTask = null
        }
      },
      connectTransport: async () => {
        warmClock += 220
      },
      disconnectTransport: () => {},
    })

    expect(warmCoordinator.warmAtAppShell()).toBe(true)
    expect(warmCoordinator.getState()).toBe('scheduled')

    // Idle callback fires at t=1050 and completes connect at t=1270
    warmClock = 1_050
    runIdleTask!()
    await Promise.resolve()
    expect(warmCoordinator.getState()).toBe('warm_ready')

    // User navigates and hook attaches at t=1500; first event arrives 40ms later
    warmClock = 1_500
    const detachWarm = warmCoordinator.attachSubscriber()
    warmClock += 40
    warmCoordinator.recordFirstEvent()

    const warmMetrics = warmCoordinator.getTimingMetrics()
    expect(warmMetrics.timeToFirstEventFromAttachMs).toBe(40)
    expect(warmMetrics.timeToFirstEventFromAttachMs!).toBeLessThan(
      coldMetrics.timeToFirstEventFromAttachMs!,
    )
    detachWarm()
    warmCoordinator.dispose()
  })

  it('closes an unused warmed connection after idleAbandonTimeoutMs', async () => {
    vi.useFakeTimers()
    try {
      const disconnects: string[] = []
      const coordinator = new RealtimeWarmupCoordinator({
        idleAbandonTimeoutMs: 5_000,
        signals: { isServer: false },
        scheduleIdle: (cb) => {
          cb()
          return () => {}
        },
        connectTransport: () => {},
        disconnectTransport: (reason) => disconnects.push(reason),
      })

      coordinator.warmAtAppShell()
      await Promise.resolve()
      expect(coordinator.getState()).toBe('warm_ready')

      vi.advanceTimersByTime(4_900)
      expect(disconnects).toEqual([])

      vi.advanceTimersByTime(200)
      expect(coordinator.getState()).toBe('abandoned')
      expect(disconnects).toEqual(['warmup_idle_timeout'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('warms on hover/focus of /cover and /provide routes and ignores non-realtime routes', () => {
    let connectCount = 0
    const coordinator = new RealtimeWarmupCoordinator({
      signals: { isServer: false },
      scheduleIdle: (cb) => {
        cb()
        return () => {}
      },
      connectTransport: () => {
        connectCount += 1
      },
      disconnectTransport: () => {},
    })

    expect(coordinator.warmOnRouteIntent('/about')).toBe(false)
    expect(coordinator.getLastSkipReason()).toBe('unsupported_route')
    expect(connectCount).toBe(0)

    expect(coordinator.warmOnRouteIntent('/cover?pool=main')).toBe(true)
    expect(connectCount).toBe(1)
    coordinator.dispose()
  })

  it('never pre-connects during SSR, when saveData is enabled, or when user opts out', () => {
    let connectCalled = false
    const createCoord = (signals: Record<string, unknown>) =>
      new RealtimeWarmupCoordinator({
        signals,
        connectTransport: () => {
          connectCalled = true
        },
        disconnectTransport: () => {},
      })

    const ssrCoord = createCoord({ isServer: true })
    expect(ssrCoord.warmAtAppShell()).toBe(false)
    expect(ssrCoord.getLastSkipReason()).toBe('ssr_environment')

    const saveDataCoord = createCoord({ isServer: false, saveData: true })
    expect(saveDataCoord.warmAtAppShell()).toBe(false)
    expect(saveDataCoord.getLastSkipReason()).toBe('save_data_enabled')

    const optOutCoord = createCoord({ isServer: false, userOptOut: true })
    expect(optOutCoord.warmAtAppShell()).toBe(false)
    expect(optOutCoord.getLastSkipReason()).toBe('user_opt_out')

    expect(connectCalled).toBe(false)
  })
})

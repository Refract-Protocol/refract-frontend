import { describe, expect, it, vi } from 'vitest'
import {
  LEGACY_POLLING_INVENTORY,
  LegacyPollingDeprecationController,
  resolveTopicFreshnessMode,
} from './pollingDeprecation'

describe('LegacyPollingDeprecationController', () => {
  it('never schedules legacy interval polling when GA gate is enabled and tears down pre-GA intervals on flip', () => {
    vi.useFakeTimers()
    try {
      const fetches: Array<{ topic: string; reason: string }> = []
      const controller = new LegacyPollingDeprecationController({
        fetchSnapshot: async (topic, reason) => {
          fetches.push({ topic, reason })
        },
      })

      // Pre-GA -> schedules legacy 15s interval for oracle_update
      const preGa = controller.reconcileTopic('oracle_update', {
        gaGateEnabled: false,
        realtimeHealthy: false,
      })
      expect(preGa.mode).toBe('legacy_interval_polling')
      expect(preGa.scheduleLegacyInterval).toBe(true)
      expect(controller.getActiveIntervalTopics()).toEqual(['oracle_update'])

      // Flip GA gate on -> immediately removes interval timer
      const gaHealthy = controller.reconcileTopic('oracle_update', {
        gaGateEnabled: true,
        realtimeHealthy: true,
      })
      expect(gaHealthy.mode).toBe('realtime_primary')
      expect(gaHealthy.scheduleLegacyInterval).toBe(false)
      expect(controller.getActiveIntervalTopics()).toEqual([])

      vi.advanceTimersByTime(60_000)
      expect(fetches).toEqual([])
      controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('executes a bounded single-fetch fallback once per degradation episode and supports manual refresh', async () => {
    const fetches: Array<{ topic: string; reason: string }> = []
    const controller = new LegacyPollingDeprecationController({
      fetchSnapshot: async (topic, reason) => {
        fetches.push({ topic, reason })
      },
    })

    const degradedHealth = {
      gaGateEnabled: true,
      realtimeHealthy: false,
      killSwitchActive: true,
    }

    const res = resolveTopicFreshnessMode('claims:updates', degradedHealth)
    expect(res.mode).toBe('single_fetch_fallback')
    expect(res.scheduleLegacyInterval).toBe(false)

    // First fallback call fetches once; second call in same episode is a no-op
    expect(
      await controller.runBoundedFallbackFetch('claims:updates', degradedHealth),
    ).toBe(true)
    expect(
      await controller.runBoundedFallbackFetch('claims:updates', degradedHealth),
    ).toBe(false)
    expect(fetches).toEqual([{ topic: 'claims:updates', reason: 'fallback' }])

    // Manual refresh always works when circuit breaker is closed
    expect(
      await controller.manualRefresh('claims:updates', degradedHealth),
    ).toBe(true)
    expect(fetches).toHaveLength(2)

    // Circuit breaker open blocks both fallback and manual refresh
    expect(
      await controller.manualRefresh('claims:updates', {
        ...degradedHealth,
        circuitBreakerOpen: true,
      }),
    ).toBe(false)
    expect(LEGACY_POLLING_INVENTORY).toHaveLength(4)
    controller.dispose()
  })
})

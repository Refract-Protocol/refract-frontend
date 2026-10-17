import { describe, expect, it } from 'vitest'
import {
  computeFidelitySubscriptionDelta,
  evaluateClientFidelityTier,
  RealtimeFidelityController,
  type RealtimeFidelityTier,
} from './fidelity'

describe('Realtime Fidelity Modes', () => {
  it('evaluates client constraint signals into full, lite, or minimal tiers with SSR-safe defaults', () => {
    expect(evaluateClientFidelityTier({})).toBe('full')
    expect(
      evaluateClientFidelityTier({
        effectiveType: '4g',
        saveData: false,
        batteryLevel: 0.85,
        batteryCharging: true,
        hardwareConcurrency: 8,
      }),
    ).toBe('full')

    // 3G or low battery (<= 30% discharging) or 2 cores -> lite
    expect(evaluateClientFidelityTier({ effectiveType: '3g' })).toBe('lite')
    expect(
      evaluateClientFidelityTier({
        effectiveType: '4g',
        batteryLevel: 0.25,
        batteryCharging: false,
      }),
    ).toBe('lite')
    expect(
      evaluateClientFidelityTier({
        effectiveType: '4g',
        hardwareConcurrency: 2,
      }),
    ).toBe('lite')

    // saveData, 2g, slow-2g, or critical battery (<= 15% discharging) -> minimal
    expect(evaluateClientFidelityTier({ saveData: true })).toBe('minimal')
    expect(evaluateClientFidelityTier({ effectiveType: '2g' })).toBe('minimal')
    expect(
      evaluateClientFidelityTier({
        effectiveType: '4g',
        batteryLevel: 0.12,
        batteryCharging: false,
      }),
    ).toBe('minimal')
  })

  it('prevents rapid tier flapping via hysteresis cooldown while allowing immediate severe downgrade', () => {
    let clock = 1_700_000_000_000
    const transitions: Array<{ next: RealtimeFidelityTier; prev: RealtimeFidelityTier }> = []

    const controller = new RealtimeFidelityController({
      hysteresisCooldownMs: 10_000,
      initialSignals: { effectiveType: '4g', saveData: false },
      now: () => clock,
      onTierChange: (next, prev) => transitions.push({ next, prev }),
    })

    expect(controller.getEffectiveTier()).toBe('full')

    // 2s later, 3g signal arrives -> blocked by 10s hysteresis cooldown
    clock += 2_000
    expect(controller.updateSignals({ effectiveType: '3g' })).toBe('full')
    expect(transitions).toHaveLength(0)

    // After 10s total elapsed, 3g signal downgrades to 'lite'
    clock += 8_500
    expect(controller.updateSignals({ effectiveType: '3g' })).toBe('lite')
    expect(transitions).toEqual([{ next: 'lite', prev: 'full' }])

    // 1s later, recovery to 4g arrives -> blocked by hysteresis cooldown
    clock += 1_000
    expect(controller.updateSignals({ effectiveType: '4g' })).toBe('lite')

    // Severe constraint (saveData: true) downgrades immediately to 'minimal' even inside cooldown
    clock += 500
    expect(controller.updateSignals({ saveData: true })).toBe('minimal')
    expect(transitions).toEqual([
      { next: 'lite', prev: 'full' },
      { next: 'minimal', prev: 'lite' },
    ])
  })

  it('computes subscribe/unsubscribe deltas across tier changes without dropping pinned critical topics', () => {
    const desiredTopics = [
      'claims:0xuser1',
      'policies:0xuser1',
      'pool:liquidity',
      'governance:proposals',
      'telemetry:metrics',
    ]

    // In 'lite' mode, governance and telemetry are pruned
    const liteDelta = computeFidelitySubscriptionDelta({
      currentSubscriptions: desiredTopics,
      desiredTopics,
      tier: 'lite',
    })
    expect(liteDelta.activeTopics).toEqual([
      'claims:0xuser1',
      'policies:0xuser1',
      'pool:liquidity',
    ])
    expect(liteDelta.toUnsubscribe).toEqual([
      'governance:proposals',
      'telemetry:metrics',
    ])
    expect(liteDelta.toSubscribe).toEqual([])

    // In 'minimal' mode, only 'claims' family + explicitly pinned topics remain
    const minimalDelta = computeFidelitySubscriptionDelta({
      currentSubscriptions: liteDelta.activeTopics,
      desiredTopics,
      pinnedTopics: ['policies:0xuser1'], // Pinned active route topic
      tier: 'minimal',
    })
    expect(minimalDelta.activeTopics).toEqual([
      'claims:0xuser1',
      'policies:0xuser1',
    ])
    expect(minimalDelta.retained).toEqual([
      'claims:0xuser1',
      'policies:0xuser1',
    ])
    expect(minimalDelta.toUnsubscribe).toEqual(['pool:liquidity'])
  })

  it('supports manual override and restores automatic tier when override is cleared', () => {
    const controller = new RealtimeFidelityController({
      initialSignals: { effectiveType: '2g' },
    })

    expect(controller.getEffectiveTier()).toBe('minimal')
    expect(controller.getEffectiveProfile().preferredTransport).toBe('polling')

    controller.setManualOverride('full')
    expect(controller.getEffectiveTier()).toBe('full')
    expect(controller.getEffectiveProfile().coalesceIntervalMs).toBe(50)

    controller.setManualOverride(null)
    expect(controller.getEffectiveTier()).toBe('minimal')
    controller.dispose()
  })
})

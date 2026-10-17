import { describe, expect, it } from 'vitest'
import {
  RealtimeBoundaryCoordinator,
  type RealtimeBoundaryErrorContext,
} from './errorBoundary'

describe('RealtimeBoundaryCoordinator', () => {
  it('isolates failures per route section, activates REST fallback, and redacts payload contents', () => {
    const degradedCalls: Array<{ topic: string; route: string }> = []
    const reports: RealtimeBoundaryErrorContext[] = []

    const coordinator = new RealtimeBoundaryCoordinator({
      maxRetriesBeforeLock: 2,
      now: () => 1_700_000_000_000,
      onDegradeTopic: (topic, route) => degradedCalls.push({ topic, route }),
      onReportError: (ctx) => reports.push(ctx),
    })

    const failed = coordinator.captureFailure({
      route: '/cover',
      topic: 'policies:quotes',
      transport: 'websocket',
      error: new Error(
        'Decoder failed on payload {"secret":"token123"} for wallet GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      ),
    })

    expect(failed.degraded).toBe(true)
    expect(failed.fallbackMode).toBe('rest_fallback')
    expect(degradedCalls).toEqual([{ topic: 'policies:quotes', route: '/cover' }])
    expect(reports).toHaveLength(1)
    expect(reports[0].errorMessage).not.toContain('token123')
    expect(reports[0].errorMessage).not.toContain(
      'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
    )

    // Sibling section on the same route remains completely unaffected
    const sibling = coordinator.getBoundaryState('/cover', 'oracle_update')
    expect(sibling.degraded).toBe(false)
    expect(sibling.fallbackMode).toBe('realtime')
  })

  it('supports idempotent retryRealtime and locks retry after maxRetriesBeforeLock or fallback failure', () => {
    const restoredCalls: string[] = []
    const coordinator = new RealtimeBoundaryCoordinator({
      maxRetriesBeforeLock: 2,
      onRestoreTopic: (topic) => restoredCalls.push(topic),
    })

    // First failure -> can retry
    coordinator.captureFailure({
      route: '/provide',
      topic: 'pool:liquidity',
      error: new Error('schema_mismatch'),
    })
    const restored = coordinator.retryRealtime('/provide', 'pool:liquidity')
    expect(restored.degraded).toBe(false)
    expect(restoredCalls).toEqual(['pool:liquidity'])

    // Calling retry again when already healthy is a no-op
    coordinator.retryRealtime('/provide', 'pool:liquidity')
    expect(restoredCalls).toHaveLength(1)

    // Second failure hits maxRetriesBeforeLock (2) -> locks retry to prevent infinite loop
    const secondFailure = coordinator.captureFailure({
      route: '/provide',
      topic: 'pool:liquidity',
      error: new Error('schema_mismatch_again'),
    })
    expect(secondFailure.retryLocked).toBe(true)
    expect(
      coordinator.retryRealtime('/provide', 'pool:liquidity').degraded,
    ).toBe(true)
  })
})

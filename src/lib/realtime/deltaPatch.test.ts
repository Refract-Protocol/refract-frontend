import { describe, expect, it } from 'vitest'
import {
  TopicDeltaStateCoordinator,
  applyRevisionedPatch,
} from './deltaPatch'

describe('Delta/Patch Protocol & TopicDeltaStateCoordinator (#291)', () => {
  it('produces identical state when applying a sequence of delta patches vs full snapshots', () => {
    const patchCoordinator = new TopicDeltaStateCoordinator()
    const snapshotCoordinator = new TopicDeltaStateCoordinator()

    const initialSnapshot = {
      totalUsdc: '184000000000000',
      lockedUsdc: '29000000000000',
      utilizationBps: 1576,
      apyBps: 890,
      tranches: {
        senior: { apyBps: 650 },
        junior: { apyBps: 1240 },
      },
    }

    patchCoordinator.processFrame({
      type: 'snapshot',
      topic: 'pool:main',
      revision: 1,
      payload: initialSnapshot,
    })

    // Apply 3 sequential patches (rev 1 -> 2 -> 3 -> 4)
    patchCoordinator.processFrame({
      type: 'patch',
      topic: 'pool:main',
      base_revision: 1,
      revision: 2,
      patch: { utilizationBps: 1620 },
    })
    patchCoordinator.processFrame({
      type: 'patch',
      topic: 'pool:main',
      base_revision: 2,
      revision: 3,
      patch: {
        lockedUsdc: '31000000000000',
        tranches: { senior: { apyBps: 670 } } as unknown as typeof initialSnapshot.tranches,
      },
    })
    patchCoordinator.processFrame({
      type: 'patch',
      topic: 'pool:main',
      base_revision: 3,
      revision: 4,
      patch: { apyBps: 915 },
    })

    // Apply corresponding full snapshot at revision 4 to snapshotCoordinator
    snapshotCoordinator.processFrame({
      type: 'snapshot',
      topic: 'pool:main',
      revision: 4,
      payload: {
        totalUsdc: '184000000000000',
        lockedUsdc: '31000000000000',
        utilizationBps: 1620,
        apyBps: 915,
        tranches: {
          senior: { apyBps: 670 },
          junior: { apyBps: 1240 },
        },
      },
    })

    expect(patchCoordinator.getTopicState('pool:main')).toEqual(
      snapshotCoordinator.getTopicState('pool:main')
    )
  })

  it('rejects revision gaps without mutating state, triggers snapshot resync, and ignores duplicate/stale patches', () => {
    const resyncRequests: Array<{
      topic: string
      expected: number | null
      received: number
    }> = []

    const coordinator = new TopicDeltaStateCoordinator<{
      price: number
      round: number
    }>({
      onResyncRequired: (topic, expected, received) =>
        resyncRequests.push({ topic, expected, received }),
    })

    const baseState = Object.freeze({ price: 0.125, round: 10 })
    coordinator.processFrame({
      type: 'snapshot',
      topic: 'oracle:XLM/USD',
      revision: 10,
      payload: baseState,
    })

    // 1. Duplicate/stale patch (revision 10 <= current 10) -> ignored idempotently
    const dupRes = coordinator.processFrame({
      type: 'patch',
      topic: 'oracle:XLM/USD',
      base_revision: 9,
      revision: 10,
      patch: { price: 0.999 },
    })
    expect(dupRes.status).toBe('ignored_stale_or_duplicate')
    expect(coordinator.getTopicState('oracle:XLM/USD')?.state).toEqual(baseState)

    // 2. Revision gap (base_revision=12 !== current 10) -> rejected without state mutation & triggers resync
    const gapRes = coordinator.processFrame({
      type: 'patch',
      topic: 'oracle:XLM/USD',
      base_revision: 12,
      revision: 13,
      patch: { price: 0.14 },
    })
    expect(gapRes.status).toBe('rejected_revision_gap')
    expect(coordinator.getTopicState('oracle:XLM/USD')?.state).toEqual(baseState)
    expect(resyncRequests).toEqual([
      { topic: 'oracle:XLM/USD', expected: 10, received: 12 },
    ])

    // 3. Full snapshot at revision 15 supersedes any prior state; subsequent old patch (rev 14) is discarded
    coordinator.processFrame({
      type: 'snapshot',
      topic: 'oracle:XLM/USD',
      revision: 15,
      payload: { price: 0.15, round: 15 },
    })
    const staleAfterSnap = coordinator.processFrame({
      type: 'patch',
      topic: 'oracle:XLM/USD',
      base_revision: 13,
      revision: 14,
      patch: { price: 0.01 },
    })
    expect(staleAfterSnap.status).toBe('ignored_stale_or_duplicate')
    expect(coordinator.getTopicState('oracle:XLM/USD')).toEqual({
      state: { price: 0.15, round: 15 },
      revision: 15,
    })
  })

  it('rejects malformed patches without mutating the input state object', () => {
    const state = Object.freeze({ a: 1, b: 2 })
    const malformed = applyRevisionedPatch(state, 5, {
      type: 'patch',
      topic: 'pool:main',
      base_revision: 5,
      revision: 4, // invalid: revision <= base_revision
      patch: { a: 99 },
    })

    expect(malformed.status).toBe('rejected_malformed')
    expect(state).toEqual({ a: 1, b: 2 })
  })
})

import { describe, expect, it } from 'vitest'
import {
  isRestAbortError,
  MonotonicTopicCommitGuard,
} from './staleRestGuard'

describe('MonotonicTopicCommitGuard', () => {
  it('prevents a slow in-flight REST response from overwriting a newer realtime update and aborts its AbortController', () => {
    let clock = 1_700_000_000_000
    const guard = new MonotonicTopicCommitGuard({ now: () => clock })

    // 1. REST request starts at t=0
    const restStartedAt = clock
    const { controller, release } =
      guard.registerInFlightRestRequest('claims:0x1')
    expect(controller.signal.aborted).toBe(false)

    // 2. At t=120ms, a realtime event arrives with sequence=12, status='APPROVED'
    clock += 120
    const rtDecision = guard.tryCommit({
      topic: 'claims:0x1',
      source: 'realtime',
      sequence: 12,
      serverTimestamp: clock,
      data: { status: 'APPROVED' },
    })
    expect(rtDecision.committed).toBe(true)
    expect(controller.signal.aborted).toBe(true)

    // 3. At t=400ms, the slow REST request resolves with older status='PENDING' (sequence=11)
    clock += 280
    const staleRestBySeq = guard.tryCommit({
      topic: 'claims:0x1',
      source: 'rest',
      sequence: 11,
      requestStartedAt: restStartedAt,
      data: { status: 'PENDING' },
    })
    expect(staleRestBySeq.committed).toBe(false)
    expect(staleRestBySeq.reason).toBe('stale_sequence_dropped')
    expect(staleRestBySeq.state).toEqual({ status: 'APPROVED' })

    // Even without sequence, requestStartedAt < appliedAt drops the superseded REST response
    const staleRestByStart = guard.tryCommit({
      topic: 'claims:0x1',
      source: 'rest',
      requestStartedAt: restStartedAt,
      data: { status: 'PENDING' },
    })
    expect(staleRestByStart.committed).toBe(false)
    expect(staleRestByStart.reason).toBe('in_flight_superseded_by_realtime')

    release()
  })

  it('prefers realtime on equal/missing timestamps while online and allows fresher REST data when realtime is offline', () => {
    let clock = 10_000
    const guard = new MonotonicTopicCommitGuard({
      clockSkewToleranceMs: 500,
      realtimeOnline: true,
      now: () => clock,
    })

    guard.tryCommit({
      topic: 'oracle_update',
      source: 'realtime',
      serverTimestamp: 10_000,
      data: { price: 1.002 },
    })

    // Equal timestamp from REST while realtime is online -> dropped
    const tieRest = guard.tryCommit({
      topic: 'oracle_update',
      source: 'rest',
      serverTimestamp: 10_000,
      data: { price: 0.998 },
    })
    expect(tieRest.committed).toBe(false)

    // Realtime goes offline -> REST fallback response with newer or unverifiable timestamp is committed
    guard.setRealtimeOnline(false)
    clock += 5_000
    const offlineFallback = guard.tryCommit({
      topic: 'oracle_update',
      source: 'rest',
      data: { price: 1.005 },
    })
    expect(offlineFallback.committed).toBe(true)
    expect(offlineFallback.reason).toBe('offline_rest_fallback')
    expect(guard.getCommittedValue('oracle_update')).toEqual({ price: 1.005 })
  })

  it('classifies AbortError instances as non-error cancellations', () => {
    const abortErr = Object.assign(new Error('The operation was aborted.'), {
      name: 'AbortError',
    })
    expect(isRestAbortError(abortErr)).toBe(true)
    expect(isRestAbortError(new Error('HTTP 500 Internal Server Error'))).toBe(
      false,
    )
  })
})

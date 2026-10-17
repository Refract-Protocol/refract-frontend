import { describe, expect, it, vi } from 'vitest'
import {
  createFakeTransportMountScope,
  FakeRealtimeTransport,
  type FakeTransportConnectionState,
} from './fakeTransport'

describe('FakeRealtimeTransport', () => {
  it('connects, subscribes, emits typed events, and records outbound frames', async () => {
    let clock = 1700000000000
    const transport = new FakeRealtimeTransport({ now: () => clock })

    const releaseConnect = transport.connect()
    expect(transport.getState()).toBe('connected')

    const received: Array<{ claimId: string; status: string }> = []
    const waiter = transport.waitForSubscription('claims:0xabc')

    const unsubscribe = transport.subscribe<{ claimId: string; status: string }>(
      'claims:0xabc',
      (envelope) => {
        received.push(envelope.payload)
      },
    )

    await waiter
    expect(transport.getActiveSubscriptions()).toEqual(['claims:0xabc'])

    clock += 250
    const emitted = transport.emitEvent('claims:0xabc', {
      claimId: 'claim-42',
      status: 'APPROVED',
    })

    expect(emitted.sequence).toBe(1)
    expect(emitted.timestamp).toBe(1700000000250)
    expect(received).toEqual([{ claimId: 'claim-42', status: 'APPROVED' }])

    transport.send('claims:0xabc', { ack: true })
    expect(transport.getSentFrames()).toHaveLength(2)
    expect(transport.getSentFrames()[0].type).toBe('subscribe')
    expect(transport.getSentFrames()[1]).toMatchObject({
      type: 'message',
      topic: 'claims:0xabc',
      payload: { ack: true },
    })

    const unsubWaiter = transport.waitForUnsubscription('claims:0xabc')
    unsubscribe()
    await unsubWaiter

    releaseConnect()
    expect(() => transport.assertCleanTeardown()).not.toThrow()
  })

  it('supports forceClose, forceReconnect, forceOpen, and forceError transitions', () => {
    const transport = new FakeRealtimeTransport({ autoConnect: true })
    const transitions: FakeTransportConnectionState[] = []
    const errors: string[] = []

    const offState = transport.onStateChange((state) => {
      transitions.push(state)
    })
    const offError = transport.onError((err) => {
      errors.push(err.message)
    })

    transport.forceClose(1006, 'network_drop')
    transport.forceReconnect()
    transport.forceOpen()
    transport.forceError('handshake_timeout')

    expect(transitions).toEqual([
      'disconnected',
      'reconnecting',
      'connected',
      'error',
    ])
    expect(errors).toEqual(['handshake_timeout'])

    offState()
    offError()
    transport.disconnect()
    expect(() => transport.assertCleanTeardown()).not.toThrow()
  })

  it('survives React 18 StrictMode double-mount and unmount cycles with zero leaked listeners or timers', () => {
    const transport = new FakeRealtimeTransport()
    const scope = createFakeTransportMountScope(transport)
    const events: number[] = []
    const states: FakeTransportConnectionState[] = []

    // 1. Initial mount
    const unmountFirst = scope.mount<number>(
      'pool:liquidity',
      (env) => events.push(env.payload),
      { onStateChange: (s) => states.push(s) },
    )
    expect(transport.getListenerCount('pool:liquidity')).toBe(1)

    // 2. StrictMode immediate simulated unmount
    unmountFirst()
    expect(transport.getListenerCount('pool:liquidity')).toBe(0)
    expect(() => transport.assertCleanTeardown()).not.toThrow()

    // 3. StrictMode immediate remount
    const unmountSecond = scope.mount<number>(
      'pool:liquidity',
      (env) => events.push(env.payload),
      { onStateChange: (s) => states.push(s) },
    )
    expect(transport.getListenerCount('pool:liquidity')).toBe(1)

    transport.emitEvent('pool:liquidity', 500_000)
    expect(events).toEqual([500_000])

    // Final unmount
    unmountSecond()
    expect(() => transport.assertCleanTeardown()).not.toThrow()
  })

  it('detects leaked subscriptions, listeners, and active timers in assertCleanTeardown', () => {
    const transport = new FakeRealtimeTransport()
    const release = transport.connect()
    const unsub = transport.subscribe('governance:proposals', () => {})

    expect(() => transport.assertCleanTeardown()).toThrow(
      /active topic subscriptions remain \[governance:proposals\]/,
    )

    unsub()

    const offState = transport.onStateChange(() => {})
    expect(() => transport.assertCleanTeardown()).toThrow(
      /state listener\(s\) still registered/,
    )
    offState()

    const timer = transport.registerTimer(() => {}, 10_000)
    expect(() => transport.assertCleanTeardown()).toThrow(/timer\(s\) still active/)
    transport.clearTimer(timer)

    expect(() => transport.assertCleanTeardown()).toThrow(/connectRefCount is 1/)
    release()

    expect(() => transport.assertCleanTeardown()).not.toThrow()
  })

  it('rejects waitForSubscription when topic is not subscribed before timeout', async () => {
    vi.useFakeTimers()
    try {
      const transport = new FakeRealtimeTransport()
      const promise = transport.waitForSubscription('claims:missing', 200)
      vi.advanceTimersByTime(250)
      await expect(promise).rejects.toThrow(
        'Timed out waiting for subscribe on topic "claims:missing" after 200ms',
      )
      expect(() => transport.assertCleanTeardown()).not.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })
})

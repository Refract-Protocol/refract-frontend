import { describe, expect, it } from 'vitest'
import { RealtimeEventBus } from './eventBus'

describe('RealtimeEventBus (#304)', () => {
  it('fans out events in arrival order, isolates throwing handlers, and replays latest values to late subscribers', () => {
    const errors: Array<{ topic: string; message: string }> = []
    const bus = new RealtimeEventBus({
      onHandlerError: (topic, err) =>
        errors.push({
          topic,
          message: err instanceof Error ? err.message : String(err),
        }),
    })

    const receivedA: number[] = []
    const receivedB: number[] = []

    bus.subscribe<{ price: number }>('oracle:XLM/USD', (evt) => {
      receivedA.push(evt.payload.price)
    })

    // Throwing handler registered in the middle
    bus.subscribe('oracle:XLM/USD', () => {
      throw new Error('Component render handler crashed')
    })

    bus.subscribe<{ price: number }>('oracle:XLM/USD', (evt) => {
      receivedB.push(evt.payload.price)
    })

    bus.publish('oracle:XLM/USD', { price: 0.11 }, { sequence: 1 })
    bus.publish('oracle:XLM/USD', { price: 0.12 }, { sequence: 2 })

    // Both healthy subscribers received events in exact order despite the throwing handler
    expect(receivedA).toEqual([0.11, 0.12])
    expect(receivedB).toEqual([0.11, 0.12])
    expect(errors).toHaveLength(2)

    // Late subscriber reads current value via getLatest and replayLatest: true
    expect(bus.getLatest<{ price: number }>('oracle:XLM/USD')?.payload.price).toBe(
      0.12
    )

    const lateReceived: number[] = []
    bus.subscribe<{ price: number }>(
      'oracle:XLM/USD',
      (evt) => lateReceived.push(evt.payload.price),
      { replayLatest: true }
    )
    expect(lateReceived).toEqual([0.12])
  })

  it('preserves FIFO order on re-entrant publish and cleans up handlers with zero leaks on unmount', () => {
    const firstSubscribed: string[] = []
    const lastUnsubscribed: string[] = []
    const bus = new RealtimeEventBus({
      onTopicFirstSubscribed: (t) => firstSubscribed.push(t),
      onTopicLastUnsubscribed: (t) => lastUnsubscribed.push(t),
    })

    const order: string[] = []

    const unsub1 = bus.subscribe<string>('claims:GABC', (evt) => {
      order.push(`h1:${evt.payload}`)
      if (evt.payload === 'first') {
        // Re-entrant publish during delivery of 'first'
        bus.publish('claims:GABC', 'second')
      }
    })

    const unsub2 = bus.subscribe<string>('claims:GABC', (evt) => {
      order.push(`h2:${evt.payload}`)
    })

    bus.publish('claims:GABC', 'first')

    // Both h1 and h2 must finish processing 'first' BEFORE either processes 'second'
    expect(order).toEqual([
      'h1:first',
      'h2:first',
      'h1:second',
      'h2:second',
    ])

    expect(bus.getHandlerCount('claims:GABC')).toBe(2)
    unsub1()
    expect(bus.getHandlerCount('claims:GABC')).toBe(1)
    unsub2()
    // Idempotent double-unsubscribe
    unsub2()
    expect(bus.getHandlerCount('claims:GABC')).toBe(0)
    expect(bus.getActiveTopics()).toEqual([])
    expect(firstSubscribed).toEqual(['claims:GABC'])
    expect(lastUnsubscribed).toEqual(['claims:GABC'])
  })
})

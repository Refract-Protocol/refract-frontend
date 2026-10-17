import { describe, expect, it } from 'vitest'
import { StrictModeSubscriptionRegistry } from './strictModeLifecycle'

describe('StrictModeSubscriptionRegistry', () => {
  it('survives React 18 StrictMode mount -> cleanup -> remount with 1 socket connect, 1 wire subscribe, and 0 wire thrash', async () => {
    const wireSubscribes: string[] = []
    const wireUnsubscribes: string[] = []
    let socketConnects = 0
    let socketDisconnects = 0

    const registry = new StrictModeSubscriptionRegistry({
      onConnectSocket: () => {
        socketConnects += 1
      },
      onDisconnectSocket: () => {
        socketDisconnects += 1
      },
      onWireSubscribe: (t) => wireSubscribes.push(t),
      onWireUnsubscribe: (t) => wireUnsubscribes.push(t),
    })

    const receivedFirstMount: string[] = []
    const receivedRemount: string[] = []

    // 1. Initial mount
    const cleanupFirst = registry.subscribe<string>('oracle_update', (val) =>
      receivedFirstMount.push(val),
    )
    expect(registry.getTopicRefCount('oracle_update')).toBe(1)

    // 2. Synchronous StrictMode unmount
    cleanupFirst()
    expect(registry.getTopicRefCount('oracle_update')).toBe(0)

    // 3. Synchronous StrictMode remount before microtask flushes
    const cleanupSecond = registry.subscribe<string>('oracle_update', (val) =>
      receivedRemount.push(val),
    )
    expect(registry.getTopicRefCount('oracle_update')).toBe(1)

    // Allow microtasks to settle
    await Promise.resolve()
    await Promise.resolve()

    expect(socketConnects).toBe(1)
    expect(socketDisconnects).toBe(0)
    expect(wireSubscribes).toEqual(['oracle_update'])
    expect(wireUnsubscribes).toEqual([])

    // Dispatch event -> only remounted handler receives it (exactly once)
    expect(registry.dispatchEvent('oracle_update', 'tick-1')).toBe(1)
    expect(receivedFirstMount).toEqual([])
    expect(receivedRemount).toEqual(['tick-1'])

    // 4. Genuine unmount
    cleanupSecond()
    await Promise.resolve()
    await Promise.resolve()

    expect(registry.getTotalRefCount()).toBe(0)
    expect(registry.isWireSubscribed('oracle_update')).toBe(false)
    expect(registry.isSocketConnected()).toBe(false)
    expect(wireUnsubscribes).toEqual(['oracle_update'])
    expect(socketDisconnects).toBe(1)
  })

  it('makes cleanup synchronous and idempotent without corrupting sibling subscriber ref counts', async () => {
    const registry = new StrictModeSubscriptionRegistry()
    const callsA: number[] = []
    const callsB: number[] = []

    const unsubA = registry.subscribe<number>('claims:0x1', (v) =>
      callsA.push(v),
    )
    const unsubB = registry.subscribe<number>('claims:0x1', (v) =>
      callsB.push(v),
    )

    expect(registry.getTopicRefCount('claims:0x1')).toBe(2)

    // Call unsubA three times -> idempotent, ref count stays at 1 for B
    unsubA()
    unsubA()
    unsubA()
    expect(registry.getTopicRefCount('claims:0x1')).toBe(1)

    // Event emitted immediately after unsubA() never reaches A
    registry.dispatchEvent('claims:0x1', 42)
    expect(callsA).toEqual([])
    expect(callsB).toEqual([42])

    unsubB()
    await Promise.resolve()
    await Promise.resolve()
    expect(registry.getTotalRefCount()).toBe(0)
  })
})

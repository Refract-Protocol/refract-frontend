import { describe, expect, it, vi } from 'vitest'
import {
  SuspensionMonitor,
  type ResyncStatus,
  type SuspensionWakeEvent,
} from './suspensionMonitor'

function createFakeDomTargets() {
  const winListeners = new Map<string, Set<(ev: unknown) => void>>()
  const docListeners = new Map<string, Set<() => void>>()
  let visibilityState = 'visible'

  return {
    windowTarget: {
      addEventListener(type: string, listener: (ev: unknown) => void) {
        if (!winListeners.has(type)) winListeners.set(type, new Set())
        winListeners.get(type)!.add(listener)
      },
      removeEventListener(type: string, listener: (ev: unknown) => void) {
        winListeners.get(type)?.delete(listener)
      },
    },
    documentTarget: {
      get visibilityState() {
        return visibilityState
      },
      set visibilityState(val: string) {
        visibilityState = val
      },
      addEventListener(type: string, listener: () => void) {
        if (!docListeners.has(type)) docListeners.set(type, new Set())
        docListeners.get(type)!.add(listener)
      },
      removeEventListener(type: string, listener: () => void) {
        docListeners.get(type)?.delete(listener)
      },
    },
    emitWindow(type: string, ev: unknown = {}) {
      for (const fn of Array.from(winListeners.get(type) ?? [])) {
        fn(ev)
      }
    },
    emitDocument(type: string) {
      for (const fn of Array.from(docListeners.get(type) ?? [])) {
        fn()
      }
    },
    getListenerCount() {
      let count = 0
      for (const s of winListeners.values()) count += s.size
      for (const s of docListeners.values()) count += s.size
      return count
    },
  }
}

describe('SuspensionMonitor', () => {
  it('detects a 5-minute wall-clock sleep jump and executes reconnect, batch resubscribe, and snapshot resync', async () => {
    vi.useFakeTimers()
    try {
      let wallClock = 1_700_000_000_000
      const dom = createFakeDomTargets()
      const callOrder: string[] = []
      const statuses: ResyncStatus[] = []
      const recoveredEvents: SuspensionWakeEvent[] = []

      const monitor = new SuspensionMonitor({
        tickIntervalMs: 2_000,
        wakeThresholdMs: 15_000,
        now: () => wallClock,
        getActiveTopics: () => ['claims:user-1', 'pool:liquidity', 'claims:user-1'],
        forceReconnect: async () => {
          callOrder.push('forceReconnect')
        },
        resubscribeBatch: async (topics) => {
          callOrder.push(`resubscribeBatch:${topics.join(',')}`)
        },
        resyncSnapshots: async (topics) => {
          callOrder.push(`resyncSnapshots:${topics.join(',')}`)
        },
        onStatusChange: (status) => statuses.push(status),
        onWakeRecovered: (ev) => recoveredEvents.push(ev),
        windowTarget: dom.windowTarget,
        documentTarget: dom.documentTarget,
      })

      monitor.start()

      // Normal 2s tick — no drift
      wallClock += 2_000
      await monitor.checkHeartbeatDrift()
      expect(callOrder).toEqual([])

      // Simulate 5-minute OS sleep jump (300,000ms)
      wallClock += 300_000
      const wakeEvent = await monitor.checkHeartbeatDrift()

      expect(wakeEvent).not.toBeNull()
      expect(wakeEvent?.reason).toBe('clock_drift')
      expect(wakeEvent?.suspendedDurationMs).toBe(300_000)
      expect(wakeEvent?.topicsResubscribed).toEqual(['claims:user-1', 'pool:liquidity'])
      expect(callOrder).toEqual([
        'forceReconnect',
        'resubscribeBatch:claims:user-1,pool:liquidity',
        'resyncSnapshots:claims:user-1,pool:liquidity',
      ])
      expect(statuses).toEqual(['resyncing', 'synced'])
      expect(recoveredEvents).toHaveLength(1)

      monitor.stop()
      expect(dom.getListenerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('coalesces simultaneous visibilitychange, pageshow, and clock-drift wake signals into a single recovery', async () => {
    let wallClock = 1_700_000_000_000
    const dom = createFakeDomTargets()
    let reconnectCalls = 0
    let resubscribeCalls = 0
    let resyncCalls = 0

    const monitor = new SuspensionMonitor({
      wakeThresholdMs: 15_000,
      dedupeWindowMs: 2_000,
      now: () => wallClock,
      getActiveTopics: () => ['claims:0x99'],
      forceReconnect: async () => {
        reconnectCalls += 1
        await Promise.resolve()
      },
      resubscribeBatch: async () => {
        resubscribeCalls += 1
      },
      resyncSnapshots: async () => {
        resyncCalls += 1
      },
      windowTarget: dom.windowTarget,
      documentTarget: dom.documentTarget,
    })

    monitor.start()

    // Tab goes hidden before sleep
    dom.documentTarget.visibilityState = 'hidden'
    dom.emitDocument('visibilitychange')

    // 2 minutes later, OS wakes up and fires visibilitychange + pageshow + heartbeat drift together
    wallClock += 120_000
    dom.documentTarget.visibilityState = 'visible'
    dom.emitDocument('visibilitychange')
    dom.emitWindow('pageshow', { persisted: true })
    const driftPromise = monitor.checkHeartbeatDrift()

    await driftPromise
    // Allow microtasks to settle
    await new Promise((r) => setTimeout(r, 0))

    expect(reconnectCalls).toBe(1)
    expect(resubscribeCalls).toBe(1)
    expect(resyncCalls).toBe(1)
    expect(monitor.getRecoveryCount()).toBe(1)
    expect(monitor.getStatus()).toBe('synced')

    monitor.stop()
  })

  it('transitions to error status when forceReconnect or resync fails', async () => {
    let wallClock = 1_700_000_000_000
    const statuses: Array<{ status: ResyncStatus; error?: string }> = []

    const monitor = new SuspensionMonitor({
      now: () => wallClock,
      getActiveTopics: () => ['pool:metrics'],
      forceReconnect: () => {},
      resubscribeBatch: () => {},
      resyncSnapshots: async () => {
        throw new Error('snapshot_endpoint_503')
      },
      onStatusChange: (status, err) => {
        statuses.push({ status, error: err?.message })
      },
      windowTarget: null,
      documentTarget: null,
    })

    await expect(monitor.triggerRecovery('manual', 20_000)).rejects.toThrow(
      'snapshot_endpoint_503',
    )
    expect(statuses).toEqual([
      { status: 'resyncing', error: undefined },
      { status: 'error', error: 'snapshot_endpoint_503' },
    ])
  })
})

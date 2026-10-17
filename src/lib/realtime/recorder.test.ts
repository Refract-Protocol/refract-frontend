import { describe, expect, it } from 'vitest'
import {
  RealtimeSessionRecorder,
  RealtimeReplayHarness,
  type RecordedLifecycleState,
} from './recorder'

const SAMPLE_WALLET = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'

describe('RealtimeSessionRecorder & RealtimeReplayHarness (#236)', () => {
  it('records a synthetic session and replays it deterministically to produce identical consumer state transitions', () => {
    let now = 1_700_000_000_000
    const recorder = new RealtimeSessionRecorder({
      enabled: true,
      sessionId: 'incident-42',
      nowFn: () => now,
    })

    // Simulate live consumer state during recording
    const liveState = {
      lifecycleHistory: [] as RecordedLifecycleState[],
      latestPrice: 0,
      claimStatuses: [] as string[],
    }

    const applyLifecycle = (
      target: typeof liveState,
      state: RecordedLifecycleState
    ) => {
      target.lifecycleHistory.push(state)
    }
    const applyInbound = (
      target: typeof liveState,
      topic: string | undefined,
      payload: unknown
    ) => {
      const data = payload as Record<string, unknown>
      if (topic?.startsWith('oracle:')) {
        target.latestPrice = Number(data.price)
      } else if (topic?.startsWith('claims:')) {
        target.claimStatuses.push(String(data.status))
      }
    }

    // Step 1: connect
    recorder.recordLifecycle('connecting')
    applyLifecycle(liveState, 'connecting')

    now += 50
    recorder.recordLifecycle('connected')
    applyLifecycle(liveState, 'connected')

    // Step 2: inbound oracle & claim events
    now += 120
    const frame1 = { price: 0.142 }
    recorder.recordInboundFrame('oracle:XLM/USD', frame1)
    applyInbound(liveState, 'oracle:XLM/USD', frame1)

    now += 200
    const frame2 = { status: 'voting' }
    recorder.recordInboundFrame(`claims:${SAMPLE_WALLET}`, frame2)
    applyInbound(liveState, `claims:${SAMPLE_WALLET}`, frame2)

    // Step 3: transient disconnect & reconnect + final settlement frame
    now += 300
    recorder.recordLifecycle('reconnecting')
    applyLifecycle(liveState, 'reconnecting')

    now += 150
    recorder.recordLifecycle('connected')
    applyLifecycle(liveState, 'connected')

    now += 80
    const frame3 = { status: 'settled' }
    recorder.recordInboundFrame(`claims:${SAMPLE_WALLET}`, frame3)
    applyInbound(liveState, `claims:${SAMPLE_WALLET}`, frame3)

    const bundle = recorder.exportBundle()

    // Replay into a fresh consumer state
    const replayedState = {
      lifecycleHistory: [] as RecordedLifecycleState[],
      latestPrice: 0,
      claimStatuses: [] as string[],
    }

    const harness = new RealtimeReplayHarness(bundle, {
      onLifecycle: (entry) => {
        if (entry.lifecycleState) {
          applyLifecycle(replayedState, entry.lifecycleState)
        }
      },
      onInboundFrame: (entry) => {
        applyInbound(replayedState, entry.topic, entry.payload)
      },
    })

    // Step first two events manually, then play remaining instantly
    expect(harness.stepNext()?.lifecycleState).toBe('connecting')
    expect(harness.stepNext()?.lifecycleState).toBe('connected')
    const remainingPlayed = harness.playAllInstant()
    expect(remainingPlayed).toBe(5)

    expect(replayedState).toEqual(liveState)
  })

  it('redacts wallet addresses and signatures by default and allows explicit opt-in', () => {
    const recorder = new RealtimeSessionRecorder({ enabled: true })
    recorder.recordInboundFrame(`claims:${SAMPLE_WALLET}`, {
      claimant: SAMPLE_WALLET,
      signature: 'sig-raw-secret-bytes-999',
      amount: '500',
    })

    const redactedBundle = recorder.exportBundle()
    expect(redactedBundle.redacted).toBe(true)
    const redactedEntry = redactedBundle.entries[0]
    expect(redactedEntry.topic).not.toContain(SAMPLE_WALLET)
    expect(redactedEntry.topic).toContain('[REDACTED]')
    expect((redactedEntry.payload as Record<string, unknown>).claimant).toContain(
      '[REDACTED]'
    )
    expect((redactedEntry.payload as Record<string, unknown>).signature).toBe(
      '[REDACTED_SECRET]'
    )

    const unredactedBundle = recorder.exportBundle({ includeSensitive: true })
    expect(unredactedBundle.redacted).toBe(false)
    expect(unredactedBundle.entries[0].topic).toBe(`claims:${SAMPLE_WALLET}`)
    expect(
      (unredactedBundle.entries[0].payload as Record<string, unknown>).signature
    ).toBe('sig-raw-secret-bytes-999')
  })

  it('bounds the ring buffer to maxEntries and tracks droppedEntries', () => {
    const recorder = new RealtimeSessionRecorder({
      enabled: true,
      maxEntries: 3,
    })

    recorder.recordInboundFrame('oracle:XLM/USD', { seq: 1 })
    recorder.recordInboundFrame('oracle:XLM/USD', { seq: 2 })
    recorder.recordInboundFrame('oracle:XLM/USD', { seq: 3 })
    recorder.recordInboundFrame('oracle:XLM/USD', { seq: 4 })
    recorder.recordInboundFrame('oracle:XLM/USD', { seq: 5 })

    const bundle = recorder.exportBundle()
    expect(bundle.entries).toHaveLength(3)
    expect(bundle.droppedEntries).toBe(2)
    expect(bundle.entries.map((e) => (e.payload as { seq: number }).seq)).toEqual([
      3, 4, 5,
    ])
  })
})

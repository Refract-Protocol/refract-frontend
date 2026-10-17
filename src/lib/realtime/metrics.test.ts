import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { RealtimeBandwidthMeter, computeWireByteLength } from './metrics'

describe('RealtimeBandwidthMeter (#289)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accurately counts UTF-8 and binary payload bytes per topic and preserves session totals across reconnects', () => {
    let now = 1_700_000_000_000
    const meter = new RealtimeBandwidthMeter({
      nowFn: () => now,
      uiSampleIntervalMs: 1_000,
    })

    const subFrame = '{"type":"subscribe","topic":"oracle:XLM/USD"}' // 45 ASCII bytes
    const oracleFrame = '{"topic":"oracle:XLM/USD","price":"0.125"}' // 42 ASCII bytes
    const claimBinary = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) // 10 bytes

    expect(computeWireByteLength(subFrame)).toBe(45)
    expect(computeWireByteLength(oracleFrame)).toBe(42)

    meter.recordOutbound('oracle:XLM/USD', subFrame)
    meter.recordInbound('oracle:XLM/USD', oracleFrame)
    meter.recordInbound('claims:GABC', claimBinary)

    now += 60_000 // 1 minute elapsed
    const beforeReconnect = meter.getSnapshot()
    expect(beforeReconnect.sessionBytesOut).toBe(45)
    expect(beforeReconnect.sessionBytesIn).toBe(52)
    expect(beforeReconnect.currentConnectionBytesIn).toBe(52)
    expect(beforeReconnect.perTopic['oracle:XLM/USD']).toEqual({
      topic: 'oracle:XLM/USD',
      bytesIn: 42,
      bytesOut: 45,
      messagesIn: 1,
      messagesOut: 1,
      avgBytesIn: 42,
      avgBytesOut: 45,
    })
    // 97 bytes in 1 minute = 97 * 60 = 5,820 bytes/hour
    expect(beforeReconnect.estimatedBytesPerHour).toBe(5_820)

    // Reconnect resets currentConnectionBytesIn/Out while keeping sessionBytesIn/Out intact
    meter.markReconnect()
    meter.recordInbound('oracle:XLM/USD', oracleFrame)

    const afterReconnect = meter.getSnapshot()
    expect(afterReconnect.reconnectCount).toBe(1)
    expect(afterReconnect.currentConnectionBytesIn).toBe(42)
    expect(afterReconnect.sessionBytesIn).toBe(94)
  })

  it('throttles UI subscriber notifications to prevent re-render storms during high-rate streams', async () => {
    const meter = new RealtimeBandwidthMeter({ uiSampleIntervalMs: 1_000 })
    let uiNotificationCount = 0

    const unsubscribe = meter.subscribe(() => {
      uiNotificationCount += 1
    })

    // Simulate 500 high-frequency oracle frames arriving within 1 second
    for (let i = 0; i < 500; i++) {
      meter.recordInbound('oracle:XLM/USD', '{"price":"0.125"}')
    }

    expect(uiNotificationCount).toBe(0)
    await vi.advanceTimersByTimeAsync(1_000)

    // Only 1 UI update emitted for the entire 500-message burst
    expect(uiNotificationCount).toBe(1)
    expect(meter.getSnapshot().sessionMessagesIn).toBe(500)

    unsubscribe()
  })
})

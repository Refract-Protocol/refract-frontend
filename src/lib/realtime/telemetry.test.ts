import { describe, expect, it } from 'vitest'
import {
  InMemoryTelemetryExporter,
  RealtimeTelemetryInstrumenter,
  sanitizeTopicAttribute,
} from './telemetry'

const SAMPLE_WALLET = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'

describe('RealtimeTelemetryInstrumenter (#237)', () => {
  it('emits spans for connect, subscribe, and frame handling and metrics for reconnect, uptime, and fallback', () => {
    let now = 1_700_000_000_000
    const exporter = new InMemoryTelemetryExporter()
    const telemetry = new RealtimeTelemetryInstrumenter({
      enabled: true,
      exporter,
      nowFn: () => now,
      randomFn: () => 0.25,
    })

    // 1. Connect span with W3C traceparent
    const connectSpan = telemetry.startSpan('realtime.connect', {
      transport: 'ws',
    })
    expect(connectSpan.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    now += 45
    connectSpan.end('ok')

    // 2. Subscribe span correlated to connect trace
    const subSpan = telemetry.startSpan(
      'realtime.subscribe',
      { topic: `claims:${SAMPLE_WALLET}`, transport: 'ws' },
      connectSpan.traceId,
      connectSpan.spanId
    )
    now += 15
    subSpan.end('ok')

    // 3. Frame handling span + duration histogram
    const frameResult = telemetry.traceFrameHandling(
      'oracle:XLM/USD',
      'ws',
      () => {
        now += 8
        return 'processed'
      }
    )
    expect(frameResult).toBe('processed')

    // 4. Reconnect, uptime, and fallback metrics
    telemetry.recordReconnect('ws', 'heartbeat_timeout')
    telemetry.recordConnectionUptime('ws', 120_000)
    telemetry.recordFallback('ws', 'sse', 'consecutive_ws_failures')

    expect(exporter.spans).toHaveLength(3)
    expect(exporter.spans[0].name).toBe('realtime.connect')
    expect(exporter.spans[0].durationMs).toBe(45)
    expect(exporter.spans[1].name).toBe('realtime.subscribe')
    expect(exporter.spans[1].traceId).toBe(connectSpan.traceId)
    expect(exporter.spans[1].parentSpanId).toBe(connectSpan.spanId)
    expect(exporter.spans[2].name).toBe('realtime.frame.handle')
    expect(exporter.spans[2].durationMs).toBe(8)

    const metricNames = exporter.metrics.map((m) => m.name)
    expect(metricNames).toEqual([
      'realtime.frame.duration_ms',
      'realtime.reconnect.count',
      'realtime.connection.uptime_ms',
      'realtime.fallback.count',
    ])
  })

  it('prevents PII leakage and bounds topic cardinality on span and metric attributes', () => {
    expect(sanitizeTopicAttribute(`claims:${SAMPLE_WALLET}`)).toBe(
      'claims:redacted'
    )
    expect(sanitizeTopicAttribute(`notifications:${SAMPLE_WALLET}`)).toBe(
      'notifications:redacted'
    )
    expect(sanitizeTopicAttribute('oracle:XLM/USD')).toBe('oracle:XLM/USD')

    const exporter = new InMemoryTelemetryExporter()
    const telemetry = new RealtimeTelemetryInstrumenter({
      enabled: true,
      exporter,
    })

    const span = telemetry.startSpan('realtime.subscribe', {
      topic: `claims:${SAMPLE_WALLET}`,
      walletAddress: SAMPLE_WALLET,
      detail: `Subscribed for ${SAMPLE_WALLET}`,
    })
    span.end('ok')

    const recorded = exporter.spans[0]
    expect(recorded.attributes.topic).toBe('claims:redacted')
    expect(recorded.attributes.walletAddress).toBeUndefined()
    expect(String(recorded.attributes.detail)).not.toContain(SAMPLE_WALLET)
    expect(String(recorded.attributes.detail)).toContain('[REDACTED]')
  })

  it('stays disabled by default and never throws into the hot path if exporter throws', () => {
    const exporter = new InMemoryTelemetryExporter()
    const disabledTelemetry = new RealtimeTelemetryInstrumenter({ exporter })
    expect(disabledTelemetry.isEnabled()).toBe(false)

    const span = disabledTelemetry.startSpan('realtime.connect')
    span.end('ok')
    disabledTelemetry.recordReconnect('ws')
    expect(exporter.spans).toHaveLength(0)
    expect(exporter.metrics).toHaveLength(0)

    const throwingExporter = {
      exportSpan() {
        throw new Error('Exporter collector unreachable')
      },
      exportMetric() {
        throw new Error('Metrics collector unreachable')
      },
    }
    const resilientTelemetry = new RealtimeTelemetryInstrumenter({
      enabled: true,
      exporter: throwingExporter,
    })

    expect(() => {
      resilientTelemetry.traceFrameHandling('oracle:XLM/USD', 'ws', () => 42)
      resilientTelemetry.recordFallback('ws', 'sse')
    }).not.toThrow()
  })
})

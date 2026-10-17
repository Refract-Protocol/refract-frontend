/**
 * OpenTelemetry-compatible tracing and metrics instrumentation for the
 * realtime layer (#237).
 *
 * Provides a zero-throw facade for emitting spans (`connect`, `subscribe`,
 * `frame.handle`), counters (`reconnect.count`, `fallback.count`), and duration
 * histograms (`connection.uptime_ms`, `frame.duration_ms`), with W3C `traceparent`
 * propagation and strict PII / topic-cardinality sanitization.
 */

export type SpanStatus = 'ok' | 'error'

export interface TelemetrySpanRecord {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTimeMs: number
  endTimeMs: number
  durationMs: number
  status: SpanStatus
  attributes: Record<string, string | number | boolean>
}

export interface TelemetryMetricPoint {
  name: string
  kind: 'counter' | 'histogram'
  value: number
  timestampMs: number
  attributes: Record<string, string | number | boolean>
}

export interface TelemetryExporter {
  exportSpan(span: TelemetrySpanRecord): void
  exportMetric(metric: TelemetryMetricPoint): void
}

/**
 * Built-in in-memory exporter for unit tests and local diagnostics.
 */
export class InMemoryTelemetryExporter implements TelemetryExporter {
  public readonly spans: TelemetrySpanRecord[] = []
  public readonly metrics: TelemetryMetricPoint[] = []

  exportSpan(span: TelemetrySpanRecord): void {
    this.spans.push(span)
  }

  exportMetric(metric: TelemetryMetricPoint): void {
    this.metrics.push(metric)
  }

  clear(): void {
    this.spans.length = 0
    this.metrics.length = 0
  }
}

export interface RealtimeTelemetryOptions {
  /** Whether telemetry collection is enabled (default: false in local dev unless explicitly enabled). */
  enabled?: boolean
  /** Head-sampling probability in `[0, 1]` (default: `1.0`). */
  sampleRate?: number
  /** Optional OTLP/collector endpoint URL from environment configuration. */
  collectorEndpoint?: string
  /** Pluggable exporter receiving spans and metric points. */
  exporter?: TelemetryExporter
  /** Clock provider for deterministic testing. */
  nowFn?: () => number
  /** Random number generator in `[0, 1)` for sampling & ID generation. */
  randomFn?: () => number
}

const STELLAR_ADDRESS_REGEX = /\b[GSC][A-Z2-7]{55}\b/g

/**
 * Collapses high-cardinality or PII-bearing topic identifiers into bounded
 * low-cardinality topic families suitable for OpenTelemetry span/metric attributes.
 *
 * Examples:
 * - `claims:GBRPYHIL...` -> `claims:wallet`
 * - `notifications:GBRPYHIL...` -> `notifications:wallet`
 * - `oracle:XLM/USD` -> `oracle:XLM/USD`
 */
export function sanitizeTopicAttribute(topic: string): string {
  const trimmed = topic.trim()
  if (!trimmed) return 'unknown'

  const [prefix, rest] = trimmed.split(':', 2)
  const normalizedPrefix = prefix.toLowerCase()

  if (!rest) {
    return normalizedPrefix
  }

  if (
    STELLAR_ADDRESS_REGEX.test(rest) ||
    normalizedPrefix === 'claims' ||
    normalizedPrefix === 'notifications' ||
    normalizedPrefix === 'wallet' ||
    normalizedPrefix === 'user'
  ) {
    STELLAR_ADDRESS_REGEX.lastIndex = 0
    return `${normalizedPrefix}:redacted`
  }

  // Cap length to guard against arbitrary high-cardinality dynamic suffixes
  const safeSuffix = rest.replace(STELLAR_ADDRESS_REGEX, '[REDACTED]').slice(0, 24)
  return `${normalizedPrefix}:${safeSuffix}`
}

/**
 * Strips any accidental Stellar address from arbitrary string attributes.
 */
export function sanitizeTelemetryAttributes(
  attrs: Record<string, string | number | boolean | undefined>
): Record<string, string | number | boolean> {
  const clean: Record<string, string | number | boolean> = {}
  for (const [key, val] of Object.entries(attrs)) {
    if (val === undefined) continue
    if (key.toLowerCase().includes('wallet') || key.toLowerCase().includes('address')) {
      continue
    }
    if (key === 'topic' && typeof val === 'string') {
      clean[key] = sanitizeTopicAttribute(val)
    } else if (typeof val === 'string') {
      clean[key] = val.replace(STELLAR_ADDRESS_REGEX, '[REDACTED]')
    } else {
      clean[key] = val
    }
  }
  return clean
}

export interface ActiveSpanHandle {
  readonly traceId: string
  readonly spanId: string
  readonly traceparent: string
  end(status?: SpanStatus, extraAttributes?: Record<string, string | number | boolean>): void
}

export class RealtimeTelemetryInstrumenter {
  private readonly enabled: boolean
  private readonly sampleRate: number
  private readonly collectorEndpoint?: string
  private readonly exporter?: TelemetryExporter
  private readonly nowFn: () => number
  private readonly randomFn: () => number

  constructor(options: RealtimeTelemetryOptions = {}) {
    const envEnabled =
      typeof process !== 'undefined' &&
      process.env?.NEXT_PUBLIC_REALTIME_OTEL_ENABLED === 'true'
    this.enabled = options.enabled ?? envEnabled
    this.sampleRate = Math.min(1, Math.max(0, options.sampleRate ?? 1))
    this.collectorEndpoint =
      options.collectorEndpoint ??
      (typeof process !== 'undefined'
        ? process.env?.NEXT_PUBLIC_REALTIME_OTEL_ENDPOINT
        : undefined)
    this.exporter = options.exporter
    this.nowFn = options.nowFn ?? (() => Date.now())
    this.randomFn = options.randomFn ?? (() => Math.random())
  }

  isEnabled(): boolean {
    return this.enabled
  }

  getCollectorEndpoint(): string | undefined {
    return this.collectorEndpoint
  }

  /**
   * Starts a span (`realtime.connect`, `realtime.subscribe`, `realtime.frame.handle`)
   * and returns a handle with a W3C `traceparent` header value for backend correlation.
   */
  startSpan(
    name: string,
    attributes: Record<string, string | number | boolean | undefined> = {},
    parentTraceId?: string,
    parentSpanId?: string
  ): ActiveSpanHandle {
    const sampled = this.enabled && this.randomFn() < this.sampleRate
    const traceId = parentTraceId ?? this.generateHexId(32)
    const spanId = this.generateHexId(16)
    const flags = sampled ? '01' : '00'
    const traceparent = `00-${traceId}-${spanId}-${flags}`
    const startTimeMs = this.nowFn()
    let ended = false

    return {
      traceId,
      spanId,
      traceparent,
      end: (status: SpanStatus = 'ok', extraAttributes = {}) => {
        if (ended || !sampled || !this.exporter) return
        ended = true
        try {
          const endTimeMs = this.nowFn()
          const durationMs = Math.max(0, endTimeMs - startTimeMs)
          const mergedAttrs = sanitizeTelemetryAttributes({
            ...attributes,
            ...extraAttributes,
          })
          this.exporter.exportSpan({
            traceId,
            spanId,
            parentSpanId,
            name,
            startTimeMs,
            endTimeMs,
            durationMs,
            status,
            attributes: mergedAttrs,
          })
        } catch {
          // Never throw into the realtime hot path
        }
      },
    }
  }

  /**
   * Records a reconnect attempt counter increment.
   */
  recordReconnect(transport: string, reason?: string): void {
    this.emitMetric('realtime.reconnect.count', 'counter', 1, {
      transport,
      reason: reason ?? 'unknown',
    })
  }

  /**
   * Records a transport fallback activation (e.g. `ws` -> `sse` or `sse` -> `rest`).
   */
  recordFallback(fromTransport: string, toTransport: string, reason?: string): void {
    this.emitMetric('realtime.fallback.count', 'counter', 1, {
      from_transport: fromTransport,
      to_transport: toTransport,
      reason: reason ?? 'degraded',
    })
  }

  /**
   * Records connection uptime duration in milliseconds when a session closes.
   */
  recordConnectionUptime(transport: string, uptimeMs: number): void {
    this.emitMetric(
      'realtime.connection.uptime_ms',
      'histogram',
      Math.max(0, uptimeMs),
      { transport }
    )
  }

  /**
   * Traces and times synchronous or asynchronous inbound frame handling without throwing.
   */
  traceFrameHandling<T>(
    topic: string,
    transport: string,
    fn: (traceparent: string) => T
  ): T {
    const span = this.startSpan('realtime.frame.handle', {
      topic,
      transport,
    })
    const startMs = this.nowFn()
    try {
      const result = fn(span.traceparent)
      const durationMs = Math.max(0, this.nowFn() - startMs)
      span.end('ok')
      this.emitMetric('realtime.frame.duration_ms', 'histogram', durationMs, {
        topic,
        transport,
      })
      return result
    } catch (err) {
      span.end('error', {
        error_message: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  private emitMetric(
    name: string,
    kind: 'counter' | 'histogram',
    value: number,
    attributes: Record<string, string | number | boolean | undefined>
  ): void {
    if (!this.enabled || !this.exporter) return
    try {
      this.exporter.exportMetric({
        name,
        kind,
        value,
        timestampMs: this.nowFn(),
        attributes: sanitizeTelemetryAttributes(attributes),
      })
    } catch {
      // Never let telemetry failures impact application execution
    }
  }

  private generateHexId(length: number): string {
    const chars = '0123456789abcdef'
    let out = ''
    for (let i = 0; i < length; i++) {
      const idx = Math.floor(this.randomFn() * 16) % 16
      out += chars[idx]
    }
    return out
  }
}

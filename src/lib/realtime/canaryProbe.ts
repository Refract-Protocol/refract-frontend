export type CanaryFailureStage =
  | 'connect'
  | 'auth'
  | 'subscribe'
  | 'first_event_timeout'

export interface CanaryProbeResult {
  status: 'healthy' | 'degraded' | 'failed'
  exitCode: 0 | 1
  environment: string
  transport: 'websocket' | 'sse' | 'polling'
  endpointHost: string
  topic: string
  connectDurationMs: number | null
  timeToFirstEventMs: number | null
  failureStage: CanaryFailureStage | null
  errorMessage: string | null
  consecutiveFailures: number
  alertTriggered: boolean
  checkedAt: number
}

export interface CanaryTransportSession {
  connect: () => Promise<void>
  authenticate?: () => Promise<void>
  subscribeAndWaitForFirstEvent: (
    topic: string,
    timeoutMs: number,
  ) => Promise<unknown>
  disconnect: () => Promise<void> | void
}

export interface RealtimeCanaryProbeOptions {
  endpointUrl: string
  environment?: string
  transport?: 'websocket' | 'sse' | 'polling'
  topic?: string
  probeTimeoutMs?: number
  degradedLatencyThresholdMs?: number
  /** Consecutive failures required before firing an alert (default: 2) */
  alertFailureThreshold?: number
  createSession: (endpointUrl: string) => CanaryTransportSession
  onEmitMetric?: (result: CanaryProbeResult) => void
  onAlert?: (result: CanaryProbeResult) => void
  now?: () => number
}

function extractEndpointHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return 'invalid-endpoint'
  }
}

/**
 * Synthetic realtime canary probe that executes a full connect -> auth ->
 * subscribe -> first-event cycle, records stage timings, and triggers alerts
 * after consecutive failures without spamming on a single transient blip.
 */
export class RealtimeCanaryProbe {
  private readonly options: RealtimeCanaryProbeOptions
  private readonly topic: string
  private readonly probeTimeoutMs: number
  private readonly degradedThresholdMs: number
  private readonly alertFailureThreshold: number
  private readonly now: () => number
  private consecutiveFailures = 0

  constructor(options: RealtimeCanaryProbeOptions) {
    this.options = options
    this.topic = options.topic?.trim() || 'oracle_update'
    this.probeTimeoutMs = options.probeTimeoutMs ?? 10_000
    this.degradedThresholdMs = options.degradedLatencyThresholdMs ?? 3_000
    this.alertFailureThreshold = Math.max(1, options.alertFailureThreshold ?? 2)
    this.now = options.now ?? (() => Date.now())
  }

  public async runOnce(): Promise<CanaryProbeResult> {
    const startAt = this.now()
    const endpointHost = extractEndpointHost(this.options.endpointUrl)
    const environment = this.options.environment ?? 'production'
    const transport = this.options.transport ?? 'websocket'
    const session = this.options.createSession(this.options.endpointUrl)

    let connectDurationMs: number | null = null
    let timeToFirstEventMs: number | null = null
    let currentStage: CanaryFailureStage = 'connect'

    try {
      await this.withTimeout(
        session.connect(),
        this.probeTimeoutMs,
        'Connection handshake timed out',
      )
      connectDurationMs = Math.max(0, this.now() - startAt)

      if (session.authenticate) {
        currentStage = 'auth'
        await this.withTimeout(
          session.authenticate(),
          this.probeTimeoutMs,
          'Authentication handshake timed out',
        )
      }

      currentStage = 'subscribe'
      const subStartAt = this.now()
      currentStage = 'first_event_timeout'
      await this.withTimeout(
        session.subscribeAndWaitForFirstEvent(
          this.topic,
          this.probeTimeoutMs,
        ),
        this.probeTimeoutMs,
        `Timed out waiting for first event on topic "${this.topic}"`,
      )
      timeToFirstEventMs = Math.max(0, this.now() - subStartAt)

      this.consecutiveFailures = 0
      const isDegraded =
        connectDurationMs + timeToFirstEventMs > this.degradedThresholdMs

      const result: CanaryProbeResult = {
        status: isDegraded ? 'degraded' : 'healthy',
        exitCode: 0,
        environment,
        transport,
        endpointHost,
        topic: this.topic,
        connectDurationMs,
        timeToFirstEventMs,
        failureStage: null,
        errorMessage: null,
        consecutiveFailures: 0,
        alertTriggered: false,
        checkedAt: this.now(),
      }

      this.options.onEmitMetric?.(result)
      return result
    } catch (err) {
      this.consecutiveFailures += 1
      const alertTriggered =
        this.consecutiveFailures >= this.alertFailureThreshold
      const errorMessage =
        err instanceof Error ? err.message : String(err)

      const result: CanaryProbeResult = {
        status: 'failed',
        exitCode: 1,
        environment,
        transport,
        endpointHost,
        topic: this.topic,
        connectDurationMs,
        timeToFirstEventMs,
        failureStage: currentStage,
        errorMessage,
        consecutiveFailures: this.consecutiveFailures,
        alertTriggered,
        checkedAt: this.now(),
      }

      this.options.onEmitMetric?.(result)
      if (alertTriggered) {
        this.options.onAlert?.(result)
      }
      return result
    } finally {
      try {
        await session.disconnect()
      } catch {
        // Ignore teardown errors during canary cleanup
      }
    }
  }

  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(timeoutMessage))
      }, timeoutMs)

      promise.then(
        (val) => {
          clearTimeout(timer)
          resolve(val)
        },
        (err) => {
          clearTimeout(timer)
          reject(err)
        },
      )
    })
  }
}

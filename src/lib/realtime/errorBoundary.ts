export interface RealtimeBoundaryErrorContext {
  topic: string
  route: string
  transport: 'websocket' | 'sse' | 'polling'
  errorName: string
  errorMessage: string
  occurredAt: number
}

export interface TopicDegradationState {
  topic: string
  route: string
  degraded: boolean
  fallbackMode: 'realtime' | 'rest_fallback' | 'static_fallback'
  failureCount: number
  lastError: RealtimeBoundaryErrorContext | null
  retryLocked: boolean
}

export interface RealtimeBoundaryCoordinatorOptions {
  /** Maximum manual/automatic retries before locking into static/REST fallback (default: 3) */
  maxRetriesBeforeLock?: number
  onDegradeTopic?: (topic: string, route: string) => void
  onRestoreTopic?: (topic: string, route: string) => void
  onReportError?: (context: RealtimeBoundaryErrorContext) => void
  now?: () => number
}

const PAYLOAD_LEAK_PATTERNS = [
  /\{[\s\S]*\}/g,
  /\b[GC][A-Z2-7]{10,55}\b/gi,
  /\b0x[a-fA-F0-9]{6,64}\b/g,
]

export function sanitizeBoundaryErrorMessage(rawMessage: string): string {
  let cleaned = rawMessage
  for (const pattern of PAYLOAD_LEAK_PATTERNS) {
    cleaned = cleaned.replace(pattern, '[redacted]')
  }
  return cleaned.slice(0, 200).trim() || 'realtime_boundary_error'
}

/**
 * Coordinates per-route-section realtime error boundary state, isolating render
 * and async subscription failures to the affected topic and degrading cleanly
 * to REST fallback without remount loops or payload leaks.
 */
export class RealtimeBoundaryCoordinator {
  private readonly maxRetriesBeforeLock: number
  private readonly onDegradeTopic?: (topic: string, route: string) => void
  private readonly onRestoreTopic?: (topic: string, route: string) => void
  private readonly onReportError?: (
    context: RealtimeBoundaryErrorContext,
  ) => void
  private readonly now: () => number
  private readonly states = new Map<string, TopicDegradationState>()

  constructor(options: RealtimeBoundaryCoordinatorOptions = {}) {
    this.maxRetriesBeforeLock = options.maxRetriesBeforeLock ?? 3
    this.onDegradeTopic = options.onDegradeTopic
    this.onRestoreTopic = options.onRestoreTopic
    this.onReportError = options.onReportError
    this.now = options.now ?? (() => Date.now())
  }

  public getBoundaryState(
    route: string,
    topic: string,
  ): TopicDegradationState {
    const key = this.makeKey(route, topic)
    const existing = this.states.get(key)
    if (existing) {
      return { ...existing }
    }
    return {
      topic: topic.trim(),
      route: route.trim(),
      degraded: false,
      fallbackMode: 'realtime',
      failureCount: 0,
      lastError: null,
      retryLocked: false,
    }
  }

  /**
   * Captures a render-time or async subscription error for `(route, topic)`,
   * flips the topic into `rest_fallback` mode, and reports redacted triage metadata.
   */
  public captureFailure(params: {
    route: string
    topic: string
    transport?: 'websocket' | 'sse' | 'polling'
    error: unknown
    isFallbackFailure?: boolean
  }): TopicDegradationState {
    const route = params.route.trim()
    const topic = params.topic.trim()
    const key = this.makeKey(route, topic)
    const current = this.getBoundaryState(route, topic)

    const rawMessage =
      params.error instanceof Error
        ? params.error.message
        : String(params.error)
    const errorName =
      params.error instanceof Error ? params.error.name : 'RealtimeError'

    const errorContext: RealtimeBoundaryErrorContext = {
      topic,
      route,
      transport: params.transport ?? 'websocket',
      errorName,
      errorMessage: sanitizeBoundaryErrorMessage(rawMessage),
      occurredAt: this.now(),
    }

    const nextFailureCount = current.failureCount + 1
    const retryLocked =
      Boolean(params.isFallbackFailure) ||
      nextFailureCount >= this.maxRetriesBeforeLock

    const nextState: TopicDegradationState = {
      topic,
      route,
      degraded: true,
      fallbackMode: params.isFallbackFailure
        ? 'static_fallback'
        : 'rest_fallback',
      failureCount: nextFailureCount,
      lastError: errorContext,
      retryLocked,
    }

    const wasDegraded = current.degraded
    this.states.set(key, nextState)

    if (!wasDegraded) {
      this.onDegradeTopic?.(topic, route)
    }
    this.onReportError?.(errorContext)

    return { ...nextState }
  }

  /**
   * Idempotent retry action that restores a degraded topic to `'realtime'` mode
   * unless `retryLocked` is true (preventing infinite remount loops).
   */
  public retryRealtime(route: string, topic: string): TopicDegradationState {
    const key = this.makeKey(route, topic)
    const current = this.getBoundaryState(route, topic)

    if (!current.degraded || current.retryLocked) {
      return current
    }

    const restored: TopicDegradationState = {
      ...current,
      degraded: false,
      fallbackMode: 'realtime',
    }
    this.states.set(key, restored)
    this.onRestoreTopic?.(current.topic, current.route)
    return { ...restored }
  }

  private makeKey(route: string, topic: string): string {
    return `${route.trim()}::${topic.trim()}`
  }
}

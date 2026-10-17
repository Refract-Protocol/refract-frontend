export type UpdateOriginSource = 'realtime' | 'rest'

export interface OrderedTopicUpdate<T = unknown> {
  topic: string
  source: UpdateOriginSource
  data: T
  sequence?: number
  serverTimestamp?: number
  requestStartedAt?: number
}

export interface AppliedTopicWatermark {
  topic: string
  source: UpdateOriginSource
  sequence?: number
  serverTimestamp?: number
  appliedAt: number
}

export interface CommitDecision<T = unknown> {
  committed: boolean
  reason:
    | 'initial_commit'
    | 'newer_sequence'
    | 'newer_timestamp'
    | 'realtime_tie_breaker'
    | 'offline_rest_fallback'
    | 'stale_sequence_dropped'
    | 'stale_timestamp_dropped'
    | 'in_flight_superseded_by_realtime'
  state: T
  watermark: AppliedTopicWatermark
}

export interface MonotonicTopicCommitGuardOptions {
  /** Clock-skew tolerance in ms for timestamp comparisons (default: 500ms) */
  clockSkewToleranceMs?: number
  /** Whether the realtime transport is currently online (default: true) */
  realtimeOnline?: boolean
  now?: () => number
}

export function isRestAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const maybeErr = err as { name?: string; code?: string; message?: string }
  return (
    maybeErr.name === 'AbortError' ||
    maybeErr.code === 'ABORT_ERR' ||
    Boolean(maybeErr.message?.toLowerCase().includes('aborted'))
  )
}

/**
 * Shared monotonic freshness guard preventing late-resolving REST responses
 * from overwriting fresher realtime updates, with automatic AbortController
 * cancellation for superseded in-flight REST requests.
 */
export class MonotonicTopicCommitGuard {
  private readonly clockSkewToleranceMs: number
  private readonly now: () => number
  private realtimeOnline: boolean
  private readonly watermarks = new Map<string, AppliedTopicWatermark>()
  private readonly committedValues = new Map<string, unknown>()
  private readonly inFlightControllers = new Map<string, Set<AbortController>>()

  constructor(options: MonotonicTopicCommitGuardOptions = {}) {
    this.clockSkewToleranceMs = options.clockSkewToleranceMs ?? 500
    this.realtimeOnline = options.realtimeOnline ?? true
    this.now = options.now ?? (() => Date.now())
  }

  public setRealtimeOnline(online: boolean): void {
    this.realtimeOnline = online
  }

  /**
   * Registers an AbortController for an in-flight REST request on `topic`.
   * Automatically aborted if a realtime event commits on `topic` before the fetch settles.
   */
  public registerInFlightRestRequest(topic: string): {
    controller: AbortController
    release: () => void
  } {
    const key = topic.trim()
    const controller = new AbortController()
    let set = this.inFlightControllers.get(key)
    if (!set) {
      set = new Set()
      this.inFlightControllers.set(key, set)
    }
    set.add(controller)

    return {
      controller,
      release: () => {
        set?.delete(controller)
        if (set && set.size === 0) {
          this.inFlightControllers.delete(key)
        }
      },
    }
  }

  public tryCommit<T = unknown>(
    update: OrderedTopicUpdate<T>,
  ): CommitDecision<T> {
    const key = update.topic.trim()
    const currentTime = this.now()
    const existing = this.watermarks.get(key)

    if (!existing) {
      return this.applyCommit(key, update, currentTime, 'initial_commit')
    }

    // 1. Sequence comparison when both carry sequence numbers
    if (update.sequence !== undefined && existing.sequence !== undefined) {
      if (update.sequence < existing.sequence) {
        return this.rejectCommit(key, existing, 'stale_sequence_dropped')
      }
      if (update.sequence > existing.sequence) {
        return this.applyCommit(key, update, currentTime, 'newer_sequence')
      }
      // Equal sequence tie-breaker: prefer realtime over REST
      if (update.source === 'rest' && existing.source === 'realtime') {
        return this.rejectCommit(key, existing, 'stale_sequence_dropped')
      }
      return this.applyCommit(key, update, currentTime, 'realtime_tie_breaker')
    }

    // 2. Reject REST request that started before the last realtime commit was applied
    if (
      update.source === 'rest' &&
      existing.source === 'realtime' &&
      update.requestStartedAt !== undefined &&
      update.requestStartedAt < existing.appliedAt
    ) {
      return this.rejectCommit(
        key,
        existing,
        'in_flight_superseded_by_realtime',
      )
    }

    // 3. Server timestamp comparison
    if (
      update.serverTimestamp !== undefined &&
      existing.serverTimestamp !== undefined
    ) {
      const delta = update.serverTimestamp - existing.serverTimestamp
      if (delta < -this.clockSkewToleranceMs) {
        return this.rejectCommit(key, existing, 'stale_timestamp_dropped')
      }
      if (delta > this.clockSkewToleranceMs) {
        return this.applyCommit(key, update, currentTime, 'newer_timestamp')
      }

      // Within skew / equal timestamp tie-breaker:
      if (update.source === 'realtime') {
        return this.applyCommit(
          key,
          update,
          currentTime,
          'realtime_tie_breaker',
        )
      }
      if (existing.source === 'realtime' && this.realtimeOnline) {
        return this.rejectCommit(key, existing, 'stale_timestamp_dropped')
      }
    }

    // 4. Unverifiable / missing timestamps on REST response while realtime is online and already applied
    if (
      update.source === 'rest' &&
      existing.source === 'realtime' &&
      this.realtimeOnline &&
      update.sequence === undefined &&
      update.serverTimestamp === undefined
    ) {
      return this.rejectCommit(key, existing, 'stale_timestamp_dropped')
    }

    const reason =
      update.source === 'rest' && !this.realtimeOnline
        ? 'offline_rest_fallback'
        : 'realtime_tie_breaker'

    return this.applyCommit(key, update, currentTime, reason)
  }

  public getCommittedValue<T = unknown>(topic: string): T | undefined {
    return this.committedValues.get(topic.trim()) as T | undefined
  }

  private applyCommit<T>(
    key: string,
    update: OrderedTopicUpdate<T>,
    appliedAt: number,
    reason: CommitDecision<T>['reason'],
  ): CommitDecision<T> {
    const existing = this.watermarks.get(key)
    const watermark: AppliedTopicWatermark = {
      topic: key,
      source: update.source,
      sequence: update.sequence ?? existing?.sequence,
      serverTimestamp: update.serverTimestamp ?? existing?.serverTimestamp,
      appliedAt,
    }

    this.watermarks.set(key, watermark)
    this.committedValues.set(key, update.data)

    if (update.source === 'realtime') {
      this.abortInFlightForTopic(key)
    }

    return {
      committed: true,
      reason,
      state: update.data,
      watermark,
    }
  }

  private rejectCommit<T>(
    key: string,
    existing: AppliedTopicWatermark,
    reason: CommitDecision<T>['reason'],
  ): CommitDecision<T> {
    return {
      committed: false,
      reason,
      state: this.committedValues.get(key) as T,
      watermark: existing,
    }
  }

  private abortInFlightForTopic(key: string): void {
    const controllers = this.inFlightControllers.get(key)
    if (!controllers) return
    for (const ctrl of Array.from(controllers)) {
      ctrl.abort()
    }
    this.inFlightControllers.delete(key)
  }
}

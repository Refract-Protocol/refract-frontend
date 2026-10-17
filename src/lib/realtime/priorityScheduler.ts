/**
 * Multi-queue message priority scheduler for realtime inbound dispatch (#258).
 *
 * Prioritizes critical streams (`claims`, `tx`, `auth`, `control`, `notifications`)
 * ahead of high-volume bulk streams (`oracle`, `pool`, `activity`) while
 * preserving per-topic ordering and enforcing a starvation guard so bulk
 * queues always make forward progress.
 */

export type RealtimePriorityClass = 'critical' | 'bulk'

const CRITICAL_TOPIC_PREFIXES = new Set([
  'claims',
  'claim',
  'tx',
  'transaction',
  'auth',
  'control',
  'notifications',
])

/**
 * Classifies a realtime topic into `'critical'` or `'bulk'` priority.
 */
export function resolveTopicPriority(topic: string): RealtimePriorityClass {
  const prefix = topic.trim().split(':', 1)[0]?.toLowerCase() ?? ''
  if (CRITICAL_TOPIC_PREFIXES.has(prefix)) {
    return 'critical'
  }
  return 'bulk'
}

export interface ScheduledRealtimeMessage<TPayload = unknown> {
  topic: string
  payload: TPayload
  priority?: RealtimePriorityClass
  enqueuedAt?: number
}

interface QueuedEntry<TPayload> {
  topic: string
  payload: TPayload
  priority: RealtimePriorityClass
  enqueuedAt: number
}

export interface PrioritySchedulerMetrics {
  criticalQueueDepth: number
  bulkQueueDepth: number
  dispatchedCritical: number
  dispatchedBulk: number
  droppedCritical: number
  droppedBulk: number
  maxCriticalLatencyMs: number
  lastCriticalLatencyMs: number
}

export interface MessagePrioritySchedulerOptions<TPayload = unknown> {
  /** Callback invoked when a scheduled message is drained for subscriber delivery. */
  onDispatch: (message: {
    topic: string
    payload: TPayload
    priority: RealtimePriorityClass
    queueLatencyMs: number
  }) => void
  /**
   * Maximum consecutive critical messages drained before yielding 1 slot to a
   * waiting bulk message so bulk streams are never starved indefinitely (default: 8).
   */
  maxConsecutiveCritical?: number
  /** Maximum queued critical messages before oldest critical item is dropped (default: 500). */
  maxCriticalQueueSize?: number
  /** Maximum queued bulk messages before oldest bulk item is dropped (default: 1,000). */
  maxBulkQueueSize?: number
  /** Maximum messages drained per synchronous batch tick (default: 64). */
  batchBudget?: number
  /** Clock provider for deterministic latency measurement. */
  nowFn?: () => number
}

export class MessagePriorityScheduler<TPayload = unknown> {
  private readonly onDispatch: MessagePrioritySchedulerOptions<TPayload>['onDispatch']
  private readonly maxConsecutiveCritical: number
  private readonly maxCriticalQueueSize: number
  private readonly maxBulkQueueSize: number
  private readonly batchBudget: number
  private readonly nowFn: () => number

  private readonly criticalQueue: QueuedEntry<TPayload>[] = []
  private readonly bulkQueue: QueuedEntry<TPayload>[] = []
  private consecutiveCriticalCount = 0
  private drainScheduled = false

  private dispatchedCritical = 0
  private dispatchedBulk = 0
  private droppedCritical = 0
  private droppedBulk = 0
  private maxCriticalLatencyMs = 0
  private lastCriticalLatencyMs = 0

  constructor(options: MessagePrioritySchedulerOptions<TPayload>) {
    this.onDispatch = options.onDispatch
    this.maxConsecutiveCritical = Math.max(1, options.maxConsecutiveCritical ?? 8)
    this.maxCriticalQueueSize = Math.max(1, options.maxCriticalQueueSize ?? 500)
    this.maxBulkQueueSize = Math.max(1, options.maxBulkQueueSize ?? 1_000)
    this.batchBudget = Math.max(1, options.batchBudget ?? 64)
    this.nowFn = options.nowFn ?? (() => Date.now())
  }

  /**
   * Enqueues an inbound realtime message into its priority queue and schedules
   * a microtask drain if one is not already pending.
   */
  enqueue(message: ScheduledRealtimeMessage<TPayload>): RealtimePriorityClass {
    const priority = message.priority ?? resolveTopicPriority(message.topic)
    const enqueuedAt = message.enqueuedAt ?? this.nowFn()
    const entry: QueuedEntry<TPayload> = {
      topic: message.topic,
      payload: message.payload,
      priority,
      enqueuedAt,
    }

    if (priority === 'critical') {
      if (this.criticalQueue.length >= this.maxCriticalQueueSize) {
        this.criticalQueue.shift()
        this.droppedCritical += 1
      }
      this.criticalQueue.push(entry)
    } else {
      if (this.bulkQueue.length >= this.maxBulkQueueSize) {
        this.bulkQueue.shift()
        this.droppedBulk += 1
      }
      this.bulkQueue.push(entry)
    }

    this.scheduleMicrotaskDrain()
    return priority
  }

  /**
   * Drains up to `limit` messages synchronously according to priority and
   * starvation-guard rules.
   */
  drainBatch(limit = this.batchBudget): number {
    let drained = 0
    while (drained < limit) {
      const next = this.dequeueNext()
      if (!next) break
      drained += 1

      const latencyMs = Math.max(0, this.nowFn() - next.enqueuedAt)
      if (next.priority === 'critical') {
        this.dispatchedCritical += 1
        this.lastCriticalLatencyMs = latencyMs
        if (latencyMs > this.maxCriticalLatencyMs) {
          this.maxCriticalLatencyMs = latencyMs
        }
      } else {
        this.dispatchedBulk += 1
      }

      this.onDispatch({
        topic: next.topic,
        payload: next.payload,
        priority: next.priority,
        queueLatencyMs: latencyMs,
      })
    }
    return drained
  }

  /**
   * Drains all queued messages across both classes until empty.
   */
  flushAll(): number {
    let total = 0
    while (this.criticalQueue.length > 0 || this.bulkQueue.length > 0) {
      total += this.drainBatch(this.batchBudget)
    }
    return total
  }

  getMetrics(): PrioritySchedulerMetrics {
    return {
      criticalQueueDepth: this.criticalQueue.length,
      bulkQueueDepth: this.bulkQueue.length,
      dispatchedCritical: this.dispatchedCritical,
      dispatchedBulk: this.dispatchedBulk,
      droppedCritical: this.droppedCritical,
      droppedBulk: this.droppedBulk,
      maxCriticalLatencyMs: this.maxCriticalLatencyMs,
      lastCriticalLatencyMs: this.lastCriticalLatencyMs,
    }
  }

  clear(): void {
    this.criticalQueue.length = 0
    this.bulkQueue.length = 0
    this.consecutiveCriticalCount = 0
  }

  private dequeueNext(): QueuedEntry<TPayload> | undefined {
    const hasCritical = this.criticalQueue.length > 0
    const hasBulk = this.bulkQueue.length > 0

    if (!hasCritical && !hasBulk) {
      return undefined
    }

    // Starvation guard: if we have dispatched `maxConsecutiveCritical` critical
    // messages in a row and bulk messages are waiting, dispatch 1 bulk message next
    if (
      hasCritical &&
      hasBulk &&
      this.consecutiveCriticalCount >= this.maxConsecutiveCritical
    ) {
      this.consecutiveCriticalCount = 0
      return this.bulkQueue.shift()
    }

    if (hasCritical) {
      this.consecutiveCriticalCount += 1
      return this.criticalQueue.shift()
    }

    this.consecutiveCriticalCount = 0
    return this.bulkQueue.shift()
  }

  private scheduleMicrotaskDrain(): void {
    if (this.drainScheduled) return
    this.drainScheduled = true
    queueMicrotask(() => {
      this.drainScheduled = false
      this.drainBatch(this.batchBudget)
      if (this.criticalQueue.length > 0 || this.bulkQueue.length > 0) {
        this.scheduleMicrotaskDrain()
      }
    })
  }
}

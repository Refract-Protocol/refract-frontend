/**
 * Outbound subscription and control message batcher for the realtime client (#265).
 *
 * Coalesces bursts of subscribe/unsubscribe operations within a single tick
 * into a single batched wire write, elides net-zero contradictions (subscribe
 * followed by unsubscribe before flush), enforces auth boundaries, and caps
 * pending queue memory.
 */

export type TopicControlIntent = 'subscribe' | 'unsubscribe'

export interface BatchedControlFrame {
  type: 'batch_control'
  subscribe: string[]
  unsubscribe: string[]
}

export interface ImmediateControlFrame {
  type: string
  [key: string]: unknown
}

export type OutboundWireFrame = BatchedControlFrame | ImmediateControlFrame

export interface OutboundBatcherOptions {
  /** Underlying socket/transport writer invoked when a batch or immediate frame is flushed. */
  sendFrame: (frame: OutboundWireFrame) => boolean | void
  /** Maximum distinct topics buffered in a pending batch before dropping oldest (default: 100). */
  maxQueueSize?: number
  /** Callback invoked when the pending queue exceeds `maxQueueSize` and drops the oldest entry. */
  onOverflowWarning?: (droppedTopic: string, maxQueueSize: number) => void
}

export class OutboundMessageBatcher {
  private readonly sendFrame: (frame: OutboundWireFrame) => boolean | void
  private readonly maxQueueSize: number
  private readonly onOverflowWarning?: (
    droppedTopic: string,
    maxQueueSize: number
  ) => void

  /**
   * Tracks net pending intent per topic in first-requested insertion order:
   * - If a topic is NOT currently active on the server and is queued as `subscribe`,
   *   then `unsubscribe` before flush cancels it out (net-zero elision).
   * - If a topic IS currently active on the server and is queued as `unsubscribe`,
   *   then `subscribe` before flush cancels it out (net-zero elision).
   */
  private readonly pendingByTopic = new Map<string, TopicControlIntent>()
  private readonly activeServerTopics = new Set<string>()
  private flushScheduled = false
  private droppedOverflowCount = 0

  constructor(options: OutboundBatcherOptions) {
    this.sendFrame = options.sendFrame
    this.maxQueueSize = Math.max(1, options.maxQueueSize ?? 100)
    this.onOverflowWarning = options.onOverflowWarning
  }

  /**
   * Queues a `subscribe` operation for `topic` in the current tick batch.
   */
  queueSubscribe(topic: string): void {
    const trimmed = topic.trim()
    if (!trimmed) return

    const existingIntent = this.pendingByTopic.get(trimmed)
    if (existingIntent === 'unsubscribe') {
      // Unsubscribe followed by subscribe in the same tick:
      // if already active on the server, elide completely
      if (this.activeServerTopics.has(trimmed)) {
        this.pendingByTopic.delete(trimmed)
        return
      }
      this.pendingByTopic.set(trimmed, 'subscribe')
      return
    }

    if (existingIntent === 'subscribe' || this.activeServerTopics.has(trimmed)) {
      return
    }

    this.ensureCapacity()
    this.pendingByTopic.set(trimmed, 'subscribe')
    this.scheduleMicrotaskFlush()
  }

  /**
   * Queues an `unsubscribe` operation for `topic` in the current tick batch.
   */
  queueUnsubscribe(topic: string): void {
    const trimmed = topic.trim()
    if (!trimmed) return

    const existingIntent = this.pendingByTopic.get(trimmed)
    if (existingIntent === 'subscribe') {
      // Subscribe followed by unsubscribe in the same tick:
      // if not yet active on the server, elide completely (net-zero)
      if (!this.activeServerTopics.has(trimmed)) {
        this.pendingByTopic.delete(trimmed)
        return
      }
      this.pendingByTopic.set(trimmed, 'unsubscribe')
      return
    }

    if (existingIntent === 'unsubscribe' || !this.activeServerTopics.has(trimmed)) {
      return
    }

    this.ensureCapacity()
    this.pendingByTopic.set(trimmed, 'unsubscribe')
    this.scheduleMicrotaskFlush()
  }

  /**
   * Sends a critical control message (such as `auth`) immediately.
   * Flushes any pending subscription batch BEFORE sending the immediate frame
   * so batches never cross an authentication or session boundary.
   */
  sendImmediate(frame: ImmediateControlFrame): void {
    this.flush()
    this.sendFrame(frame)
  }

  /**
   * Synchronously flushes all coalesced operations as a single `batch_control` frame.
   * If `sendFrame` returns `false` (e.g. socket closed mid-batch), pending entries
   * are retained so no operations are lost.
   */
  flush(): BatchedControlFrame | null {
    if (this.pendingByTopic.size === 0) {
      return null
    }

    const subscribe: string[] = []
    const unsubscribe: string[] = []

    for (const [topic, intent] of this.pendingByTopic.entries()) {
      if (intent === 'subscribe') {
        subscribe.push(topic)
      } else {
        unsubscribe.push(topic)
      }
    }

    if (subscribe.length === 0 && unsubscribe.length === 0) {
      this.pendingByTopic.clear()
      return null
    }

    const frame: BatchedControlFrame = {
      type: 'batch_control',
      subscribe,
      unsubscribe,
    }

    const writeResult = this.sendFrame(frame)
    if (writeResult === false) {
      // Socket was unavailable mid-batch; retain pending intents for next reconnect flush
      return null
    }

    for (const t of subscribe) {
      this.activeServerTopics.add(t)
    }
    for (const t of unsubscribe) {
      this.activeServerTopics.delete(t)
    }
    this.pendingByTopic.clear()
    return frame
  }

  /**
   * Re-establishes the active subscription set on socket reconnect before
   * flushing any newly queued operations.
   */
  flushOnReconnect(): BatchedControlFrame | null {
    // Merge any previously active server topics with pending subscribe/unsubscribe intents
    const desiredTopics = new Set<string>(this.activeServerTopics)
    for (const [topic, intent] of this.pendingByTopic.entries()) {
      if (intent === 'subscribe') {
        desiredTopics.add(topic)
      } else {
        desiredTopics.delete(topic)
      }
    }

    this.activeServerTopics.clear()
    this.pendingByTopic.clear()

    for (const topic of desiredTopics) {
      this.pendingByTopic.set(topic, 'subscribe')
    }

    return this.flush()
  }

  getPendingCount(): number {
    return this.pendingByTopic.size
  }

  getActiveServerTopics(): string[] {
    return Array.from(this.activeServerTopics)
  }

  getDroppedOverflowCount(): number {
    return this.droppedOverflowCount
  }

  private ensureCapacity(): void {
    while (this.pendingByTopic.size >= this.maxQueueSize) {
      const oldestKey = this.pendingByTopic.keys().next().value as
        | string
        | undefined
      if (oldestKey === undefined) break
      this.pendingByTopic.delete(oldestKey)
      this.droppedOverflowCount += 1
      this.onOverflowWarning?.(oldestKey, this.maxQueueSize)
    }
  }

  private scheduleMicrotaskFlush(): void {
    if (this.flushScheduled) return
    this.flushScheduled = true
    queueMicrotask(() => {
      this.flushScheduled = false
      this.flush()
    })
  }
}

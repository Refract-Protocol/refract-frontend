/**
 * Internal typed event bus decoupling the realtime wire transport from
 * in-app consumers (hooks, Zustand slices, analytics, dev panels) (#304).
 *
 * Provides per-topic ordered fan-out, handler error isolation, late-subscriber
 * snapshot replay, re-entrant publish queuing, and zero-leak teardown.
 */

export interface BusEventEnvelope<TPayload = unknown> {
  topic: string
  payload: TPayload
  sequence?: number
  timestamp: number
}

export type BusEventHandler<TPayload = unknown> = (
  event: BusEventEnvelope<TPayload>
) => void

export interface BusSubscribeOptions {
  /**
   * When true, immediately invokes the handler with the latest retained
   * snapshot value for `topic` if one exists (default: false).
   */
  replayLatest?: boolean
}

export interface RealtimeEventBusOptions {
  /** Maximum distinct handlers allowed on a single topic to guard against leaks (default: 64). */
  maxHandlersPerTopic?: number
  /** Invoked when a subscriber handler throws during delivery (error is isolated and never re-thrown). */
  onHandlerError?: (topic: string, error: unknown) => void
  /** Invoked when the first handler subscribes to a topic (useful for lazy transport wiring). */
  onTopicFirstSubscribed?: (topic: string) => void
  /** Invoked when the last handler unsubscribes from a topic. */
  onTopicLastUnsubscribed?: (topic: string) => void
  /** Clock provider for deterministic testing. */
  nowFn?: () => number
}

export class RealtimeEventBus {
  private readonly maxHandlersPerTopic: number
  private readonly onHandlerError?: (topic: string, error: unknown) => void
  private readonly onTopicFirstSubscribed?: (topic: string) => void
  private readonly onTopicLastUnsubscribed?: (topic: string) => void
  private readonly nowFn: () => number

  private readonly handlersByTopic = new Map<string, Set<BusEventHandler<unknown>>>()
  private readonly latestByTopic = new Map<string, BusEventEnvelope<unknown>>()
  private readonly publishQueueByTopic = new Map<string, BusEventEnvelope<unknown>[]>()
  private readonly drainingTopics = new Set<string>()

  constructor(options: RealtimeEventBusOptions = {}) {
    this.maxHandlersPerTopic = Math.max(1, options.maxHandlersPerTopic ?? 64)
    this.onHandlerError = options.onHandlerError
    this.onTopicFirstSubscribed = options.onTopicFirstSubscribed
    this.onTopicLastUnsubscribed = options.onTopicLastUnsubscribed
    this.nowFn = options.nowFn ?? (() => Date.now())
  }

  /**
   * Subscribes `handler` to `topic`. Returns an idempotent unsubscribe function.
   */
  subscribe<TPayload = unknown>(
    topic: string,
    handler: BusEventHandler<TPayload>,
    options: BusSubscribeOptions = {}
  ): () => void {
    const normalizedTopic = topic.trim()
    if (!normalizedTopic) {
      return () => {}
    }

    let set = this.handlersByTopic.get(normalizedTopic)
    const wasEmpty = !set || set.size === 0
    if (!set) {
      set = new Set()
      this.handlersByTopic.set(normalizedTopic, set)
    }

    const typedHandler = handler as BusEventHandler<unknown>
    if (!set.has(typedHandler)) {
      if (set.size >= this.maxHandlersPerTopic) {
        throw new Error(
          `RealtimeEventBus maxHandlersPerTopic (${this.maxHandlersPerTopic}) exceeded for "${normalizedTopic}"`
        )
      }
      set.add(typedHandler)
      if (wasEmpty) {
        this.onTopicFirstSubscribed?.(normalizedTopic)
      }
    }

    if (options.replayLatest) {
      const latest = this.latestByTopic.get(normalizedTopic) as
        | BusEventEnvelope<TPayload>
        | undefined
      if (latest) {
        this.invokeHandlerSafely(normalizedTopic, typedHandler, latest)
      }
    }

    let active = true
    return () => {
      if (!active) return
      active = false
      const currentSet = this.handlersByTopic.get(normalizedTopic)
      if (!currentSet) return
      currentSet.delete(typedHandler)
      if (currentSet.size === 0) {
        this.handlersByTopic.delete(normalizedTopic)
        this.onTopicLastUnsubscribed?.(normalizedTopic)
      }
    }
  }

  /**
   * Publishes a decoded domain event to all subscribers of `topic` in strict
   * arrival order. Re-entrant publishes for the same topic are queued FIFO.
   */
  publish<TPayload = unknown>(
    topic: string,
    payload: TPayload,
    metadata: { sequence?: number; timestamp?: number; retainSnapshot?: boolean } = {}
  ): void {
    const normalizedTopic = topic.trim()
    if (!normalizedTopic) return

    const envelope: BusEventEnvelope<TPayload> = {
      topic: normalizedTopic,
      payload,
      sequence: metadata.sequence,
      timestamp: metadata.timestamp ?? this.nowFn(),
    }

    if (metadata.retainSnapshot !== false) {
      this.latestByTopic.set(normalizedTopic, envelope)
    }

    let queue = this.publishQueueByTopic.get(normalizedTopic)
    if (!queue) {
      queue = []
      this.publishQueueByTopic.set(normalizedTopic, queue)
    }
    queue.push(envelope)

    if (this.drainingTopics.has(normalizedTopic)) {
      // Re-entrant publish: current drain loop will pick up the queued envelope in FIFO order
      return
    }

    this.drainingTopics.add(normalizedTopic)
    try {
      while (queue.length > 0) {
        const nextEnvelope = queue.shift()!
        const handlers = this.handlersByTopic.get(normalizedTopic)
        if (!handlers || handlers.size === 0) continue

        // Snapshot handler list so unsubscribes/subscribes during iteration are safe
        for (const handler of Array.from(handlers)) {
          this.invokeHandlerSafely(normalizedTopic, handler, nextEnvelope)
        }
      }
    } finally {
      this.drainingTopics.delete(normalizedTopic)
      if (queue.length === 0) {
        this.publishQueueByTopic.delete(normalizedTopic)
      }
    }
  }

  /**
   * Synchronously reads the most recently published snapshot envelope for `topic`.
   */
  getLatest<TPayload = unknown>(
    topic: string
  ): BusEventEnvelope<TPayload> | undefined {
    return this.latestByTopic.get(topic.trim()) as
      | BusEventEnvelope<TPayload>
      | undefined
  }

  getHandlerCount(topic: string): number {
    return this.handlersByTopic.get(topic.trim())?.size ?? 0
  }

  getActiveTopics(): string[] {
    return Array.from(this.handlersByTopic.keys()).sort()
  }

  clear(): void {
    this.handlersByTopic.clear()
    this.latestByTopic.clear()
    this.publishQueueByTopic.clear()
    this.drainingTopics.clear()
  }

  private invokeHandlerSafely(
    topic: string,
    handler: BusEventHandler<unknown>,
    envelope: BusEventEnvelope<unknown>
  ): void {
    try {
      handler(envelope)
    } catch (err) {
      try {
        this.onHandlerError?.(topic, err)
      } catch {
        // Never allow error reporter to break delivery
      }
    }
  }
}

/**
 * Module-scoped singleton event bus for the application realtime layer.
 */
export const realtimeEventBus = new RealtimeEventBus()

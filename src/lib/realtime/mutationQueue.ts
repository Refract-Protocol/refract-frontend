/**
 * Outbound subscription and auth mutation queue across disconnects (#271).
 *
 * Buffers desired `auth`, `subscribe`, and `unsubscribe` intent while the
 * realtime transport is disconnected, collapses repeated topic toggles to
 * their final state, reconciles against post-reconnect server resync state
 * to avoid double-subscribing, and replays auth ahead of topic mutations.
 */

export type QueuedMutationAction =
  | { kind: 'auth'; token: string; scope?: string }
  | { kind: 'subscribe'; topic: string; cursor?: string | number | null }
  | { kind: 'unsubscribe'; topic: string }

export interface OverflowDiagnostic {
  droppedTopic: string
  maxCapacity: number
  timestamp: number
}

export interface OutboundMutationQueueOptions {
  /** Maximum distinct topic mutations held while disconnected (default: 64). */
  maxCapacity?: number
  /** Callback invoked when the queue overflows and drops the oldest pending topic mutation. */
  onOverflow?: (diagnostic: OverflowDiagnostic) => void
  /** Clock provider for deterministic testing. */
  nowFn?: () => number
}

interface PendingTopicIntent {
  action: 'subscribe' | 'unsubscribe'
  cursor?: string | number | null
}

export class OutboundMutationQueue {
  private readonly maxCapacity: number
  private readonly onOverflow?: (diagnostic: OverflowDiagnostic) => void
  private readonly nowFn: () => number

  private pendingAuth: { token: string; scope?: string } | null = null
  private readonly pendingTopics = new Map<string, PendingTopicIntent>()
  private readonly overflowHistory: OverflowDiagnostic[] = []
  private replaying = false

  constructor(options: OutboundMutationQueueOptions = {}) {
    this.maxCapacity = Math.max(1, options.maxCapacity ?? 64)
    this.onOverflow = options.onOverflow
    this.nowFn = options.nowFn ?? (() => Date.now())
  }

  /**
   * Records an authentication intent while disconnected.
   * Only the latest auth token is retained and is always replayed first.
   */
  enqueueAuth(token: string, scope?: string): void {
    const trimmed = token.trim()
    if (!trimmed) return
    this.pendingAuth = { token: trimmed, scope }
  }

  /**
   * Records a topic subscription intent while disconnected.
   * Repeated toggles (`subscribe` -> `unsubscribe` -> `subscribe`) collapse
   * to the final desired state while preserving first-seen topic ordering.
   */
  enqueueSubscribe(topic: string, cursor?: string | number | null): void {
    const trimmed = topic.trim()
    if (!trimmed) return

    if (this.pendingTopics.has(trimmed)) {
      this.pendingTopics.set(trimmed, { action: 'subscribe', cursor })
      return
    }

    this.ensureCapacity()
    this.pendingTopics.set(trimmed, { action: 'subscribe', cursor })
  }

  /**
   * Records a topic unsubscription intent while disconnected.
   */
  enqueueUnsubscribe(topic: string): void {
    const trimmed = topic.trim()
    if (!trimmed) return

    if (this.pendingTopics.has(trimmed)) {
      this.pendingTopics.set(trimmed, { action: 'unsubscribe' })
      return
    }

    this.ensureCapacity()
    this.pendingTopics.set(trimmed, { action: 'unsubscribe' })
  }

  /**
   * Replays queued mutations in deterministic order (`auth` first, followed by
   * collapsed topic intents) and reconciles against `alreadySubscribedOnServer`
   * (topics already restored by the reconnect snapshot/resume handshake) so no
   * topic is double-subscribed or redundantly unsubscribed.
   *
   * If `sendFn` returns `false` or throws mid-replay, remaining un-sent intents
   * stay in the queue for the next reconnect without entering an infinite loop.
   */
  replayOnReconnect(
    sendFn: (mutation: QueuedMutationAction) => boolean | void,
    alreadySubscribedOnServer: ReadonlySet<string> | readonly string[] = []
  ): QueuedMutationAction[] {
    if (this.replaying) return []
    this.replaying = true

    const serverSet =
      alreadySubscribedOnServer instanceof Set
        ? alreadySubscribedOnServer
        : new Set(alreadySubscribedOnServer)

    const replayed: QueuedMutationAction[] = []

    try {
      // 1. Always deliver queued auth mutation before any topic mutations
      if (this.pendingAuth) {
        const authAction: QueuedMutationAction = {
          kind: 'auth',
          token: this.pendingAuth.token,
          scope: this.pendingAuth.scope,
        }
        const ok = sendFn(authAction)
        if (ok === false) {
          return replayed
        }
        this.pendingAuth = null
        replayed.push(authAction)
      }

      // 2. Replay topic mutations in original insertion order, skipping no-ops against serverSet
      for (const [topic, intent] of Array.from(this.pendingTopics.entries())) {
        if (intent.action === 'subscribe' && serverSet.has(topic)) {
          // Already subscribed by the reconnect resync path -> drop without double-subscribing
          this.pendingTopics.delete(topic)
          continue
        }
        if (intent.action === 'unsubscribe' && !serverSet.has(topic)) {
          // Not subscribed on server after reconnect -> drop redundant unsubscribe
          this.pendingTopics.delete(topic)
          continue
        }

        const mutation: QueuedMutationAction =
          intent.action === 'subscribe'
            ? { kind: 'subscribe', topic, cursor: intent.cursor }
            : { kind: 'unsubscribe', topic }

        const ok = sendFn(mutation)
        if (ok === false) {
          // Stop replay on transport error; keep remaining items queued for next reconnect
          break
        }

        this.pendingTopics.delete(topic)
        replayed.push(mutation)
      }

      return replayed
    } finally {
      this.replaying = false
    }
  }

  /**
   * Discards all queued auth and topic mutations (e.g. on explicit logout or teardown).
   */
  discardAll(): void {
    this.pendingAuth = null
    this.pendingTopics.clear()
  }

  getPendingCount(): number {
    return (this.pendingAuth ? 1 : 0) + this.pendingTopics.size
  }

  getOverflowHistory(): OverflowDiagnostic[] {
    return this.overflowHistory.slice()
  }

  private ensureCapacity(): void {
    while (this.pendingTopics.size >= this.maxCapacity) {
      const oldestTopic = this.pendingTopics.keys().next().value as
        | string
        | undefined
      if (oldestTopic === undefined) break
      this.pendingTopics.delete(oldestTopic)
      const diagnostic: OverflowDiagnostic = {
        droppedTopic: oldestTopic,
        maxCapacity: this.maxCapacity,
        timestamp: this.nowFn(),
      }
      this.overflowHistory.push(diagnostic)
      this.onOverflow?.(diagnostic)
    }
  }
}

export type TopicEventHandler<T = unknown> = (payload: T) => void

export interface StrictModeRegistryOptions {
  /** Called when the first logical subscriber for a topic attaches on the wire */
  onWireSubscribe?: (topic: string) => void
  /** Called when the last logical subscriber for a topic detaches after microtask coalescing */
  onWireUnsubscribe?: (topic: string) => void
  /** Called when the first topic across the entire registry becomes active */
  onConnectSocket?: () => void
  /** Called when all topics across the registry have drained */
  onDisconnectSocket?: () => void
}

interface TopicSlot {
  handlers: Set<TopicEventHandler<unknown>>
  wireActive: boolean
  teardownScheduled: boolean
}

/**
 * Reference-counted realtime subscription registry hardened against React 18
 * StrictMode double-invocation (`mount -> cleanup -> remount`).
 *
 * Design:
 * - Handler registration/removal is synchronous and idempotent: once a cleanup
 *   function is invoked, that handler immediately stops receiving events, and
 *   calling cleanup a second time is a strict no-op.
 * - Wire-level `unsubscribe` and socket teardown are coalesced via `queueMicrotask`
 *   so StrictMode's synchronous unmount+remount pair reuses the existing wire
 *   subscription and socket without thrashing.
 */
export class StrictModeSubscriptionRegistry {
  private readonly slots = new Map<string, TopicSlot>()
  private readonly options: StrictModeRegistryOptions
  private socketConnected = false
  private socketDisconnectScheduled = false

  constructor(options: StrictModeRegistryOptions = {}) {
    this.options = options
  }

  public subscribe<T = unknown>(
    topic: string,
    handler: TopicEventHandler<T>,
  ): () => void {
    const normalized = topic.trim()
    if (!normalized) {
      throw new Error('Topic must be a non-empty string')
    }

    let slot = this.slots.get(normalized)
    if (!slot) {
      slot = {
        handlers: new Set(),
        wireActive: false,
        teardownScheduled: false,
      }
      this.slots.set(normalized, slot)
    }

    const untyped = handler as TopicEventHandler<unknown>
    slot.handlers.add(untyped)

    if (!this.socketConnected) {
      this.socketConnected = true
      this.options.onConnectSocket?.()
    }

    if (!slot.wireActive) {
      slot.wireActive = true
      this.options.onWireSubscribe?.(normalized)
    }

    let cleanedUp = false
    return () => {
      if (cleanedUp) {
        return
      }
      cleanedUp = true

      const currentSlot = this.slots.get(normalized)
      if (!currentSlot) {
        return
      }

      // Immediately remove handler so zero events are delivered after cleanup()
      currentSlot.handlers.delete(untyped)

      if (currentSlot.handlers.size === 0 && !currentSlot.teardownScheduled) {
        currentSlot.teardownScheduled = true
        queueMicrotask(() => {
          this.finalizeTopicTeardown(normalized)
        })
      }
    }
  }

  /**
   * Synchronously flushes any pending microtask teardowns (useful in deterministic tests
   * or explicit page-hide teardown).
   */
  public flushPendingTeardowns(): void {
    for (const topic of Array.from(this.slots.keys())) {
      this.finalizeTopicTeardown(topic)
    }
  }

  public dispatchEvent<T = unknown>(topic: string, payload: T): number {
    const slot = this.slots.get(topic.trim())
    if (!slot || slot.handlers.size === 0) {
      return 0
    }
    let delivered = 0
    for (const handler of Array.from(slot.handlers)) {
      handler(payload)
      delivered += 1
    }
    return delivered
  }

  public getTopicRefCount(topic: string): number {
    return this.slots.get(topic.trim())?.handlers.size ?? 0
  }

  public getTotalRefCount(): number {
    let total = 0
    for (const slot of this.slots.values()) {
      total += slot.handlers.size
    }
    return total
  }

  public isWireSubscribed(topic: string): boolean {
    return Boolean(this.slots.get(topic.trim())?.wireActive)
  }

  public isSocketConnected(): boolean {
    return this.socketConnected
  }

  private finalizeTopicTeardown(topic: string): void {
    const slot = this.slots.get(topic)
    if (!slot) return

    slot.teardownScheduled = false
    if (slot.handlers.size > 0) {
      // A StrictMode remount (or new subscriber) attached before the microtask ran!
      return
    }

    if (slot.wireActive) {
      slot.wireActive = false
      this.options.onWireUnsubscribe?.(topic)
    }
    this.slots.delete(topic)

    if (this.getTotalRefCount() === 0 && !this.socketDisconnectScheduled) {
      this.socketDisconnectScheduled = true
      queueMicrotask(() => {
        this.socketDisconnectScheduled = false
        if (this.getTotalRefCount() === 0 && this.socketConnected) {
          this.socketConnected = false
          this.options.onDisconnectSocket?.()
        }
      })
    }
  }
}

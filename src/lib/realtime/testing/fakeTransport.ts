export type FakeTransportConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error'

export interface FakeTransportEventEnvelope<T = unknown> {
  topic: string
  payload: T
  sequence: number
  timestamp: number
  eventId: string
}

export interface FakeTransportCloseInfo {
  code: number
  reason: string
  wasClean: boolean
}

export interface FakeTransportOutboundFrame<T = unknown> {
  type: 'subscribe' | 'unsubscribe' | 'message'
  topic?: string
  payload?: T
  timestamp: number
}

export type FakeTopicListener<T = unknown> = (
  envelope: FakeTransportEventEnvelope<T>,
) => void

export type FakeStateListener = (
  state: FakeTransportConnectionState,
  closeInfo?: FakeTransportCloseInfo,
) => void

export type FakeErrorListener = (error: Error) => void

export interface FakeRealtimeTransportOptions {
  autoConnect?: boolean
  now?: () => number
}

interface PendingWaiter {
  topic: string
  type: 'subscribe' | 'unsubscribe'
  resolve: () => void
  reject: (err: Error) => void
  timerId: ReturnType<typeof setTimeout> | null
}

/**
 * In-process deterministic fake realtime transport test harness for hook
 * and component tests without monkey-patching global WebSocket/EventSource.
 */
export class FakeRealtimeTransport {
  private state: FakeTransportConnectionState = 'idle'
  private readonly now: () => number
  private readonly topicListeners = new Map<string, Set<FakeTopicListener<unknown>>>()
  private readonly stateListeners = new Set<FakeStateListener>()
  private readonly errorListeners = new Set<FakeErrorListener>()
  private readonly sentFrames: FakeTransportOutboundFrame[] = []
  private readonly pendingWaiters = new Set<PendingWaiter>()
  private readonly activeTimers = new Set<ReturnType<typeof setTimeout>>()
  private sequenceCounter = 0
  private connectRefCount = 0

  constructor(options: FakeRealtimeTransportOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    if (options.autoConnect) {
      this.forceOpen()
    }
  }

  public getState(): FakeTransportConnectionState {
    return this.state
  }

  public connect(): () => void {
    this.connectRefCount += 1
    if (this.state === 'idle' || this.state === 'disconnected' || this.state === 'error') {
      this.setState('connected')
    }
    let released = false
    return () => {
      if (released) return
      released = true
      this.connectRefCount = Math.max(0, this.connectRefCount - 1)
      if (this.connectRefCount === 0 && this. getTotalTopicListenerCount() === 0) {
        this.disconnect()
      }
    }
  }

  public disconnect(code = 1000, reason = 'normal_closure'): void {
    this.connectRefCount = 0
    this.clearAllTrackedTimers()
    this.setState('disconnected', {
      code,
      reason,
      wasClean: code === 1000,
    })
  }

  public subscribe<T = unknown>(
    topic: string,
    listener: FakeTopicListener<T>,
  ): () => void {
    const normalized = topic.trim()
    if (!normalized) {
      throw new Error('Topic must be a non-empty string')
    }

    let bucket = this.topicListeners.get(normalized)
    const wasEmpty = !bucket || bucket.size === 0
    if (!bucket) {
      bucket = new Set()
      this.topicListeners.set(normalized, bucket)
    }

    const untypedListener = listener as FakeTopicListener<unknown>
    bucket.add(untypedListener)

    if (wasEmpty) {
      this.sentFrames.push({
        type: 'subscribe',
        topic: normalized,
        timestamp: this.now(),
      })
      this.resolveWaiters(normalized, 'subscribe')
    }

    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      this.unsubscribe(normalized, listener)
    }
  }

  public unsubscribe<T = unknown>(
    topic: string,
    listener?: FakeTopicListener<T>,
  ): void {
    const normalized = topic.trim()
    const bucket = this.topicListeners.get(normalized)
    if (!bucket) return

    if (listener) {
      bucket.delete(listener as FakeTopicListener<unknown>)
    } else {
      bucket.clear()
    }

    if (bucket.size === 0) {
      this.topicListeners.delete(normalized)
      this.sentFrames.push({
        type: 'unsubscribe',
        topic: normalized,
        timestamp: this.now(),
      })
      this.resolveWaiters(normalized, 'unsubscribe')
    }
  }

  public send<T = unknown>(topic: string, payload: T): void {
    if (this.state !== 'connected') {
      throw new Error(`Cannot send on topic "${topic}" while transport state is "${this.state}"`)
    }
    this.sentFrames.push({
      type: 'message',
      topic,
      payload,
      timestamp: this.now(),
    })
  }

  public onStateChange(listener: FakeStateListener): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  public onError(listener: FakeErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => {
      this.errorListeners.delete(listener)
    }
  }

  /**
   * Deterministic test helper to push an inbound realtime event to all subscribers of a topic.
   */
  public emitEvent<T = unknown>(
    topic: string,
    payload: T,
    meta?: { sequence?: number; timestamp?: number; eventId?: string },
  ): FakeTransportEventEnvelope<T> {
    const normalized = topic.trim()
    this.sequenceCounter += 1
    const sequence = meta?.sequence ?? this.sequenceCounter
    const timestamp = meta?.timestamp ?? this.now()
    const eventId = meta?.eventId ?? `${normalized}:${sequence}`

    const envelope: FakeTransportEventEnvelope<T> = {
      topic: normalized,
      payload,
      sequence,
      timestamp,
      eventId,
    }

    const bucket = this.topicListeners.get(normalized)
    if (bucket) {
      for (const listener of Array.from(bucket)) {
        listener(envelope)
      }
    }

    return envelope
  }

  public forceOpen(): void {
    this.setState('connected')
  }

  public forceClose(code = 1006, reason = 'abnormal_closure'): void {
    this.setState('disconnected', {
      code,
      reason,
      wasClean: code === 1000,
    })
  }

  public forceReconnect(): void {
    this.setState('reconnecting')
  }

  public forceError(err: Error | string): Error {
    const errorObj = typeof err === 'string' ? new Error(err) : err
    this.setState('error')
    for (const listener of Array.from(this.errorListeners)) {
      listener(errorObj)
    }
    return errorObj
  }

  public registerTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const timerId = setTimeout(() => {
      this.activeTimers.delete(timerId)
      callback()
    }, delayMs)
    this.activeTimers.add(timerId)
    return timerId
  }

  public clearTimer(timerId: ReturnType<typeof setTimeout>): void {
    clearTimeout(timerId)
    this.activeTimers.delete(timerId)
  }

  public waitForSubscription(topic: string, timeoutMs = 1000): Promise<void> {
    const normalized = topic.trim()
    const bucket = this.topicListeners.get(normalized)
    if (bucket && bucket.size > 0) {
      return Promise.resolve()
    }
    return this.createWaiter(normalized, 'subscribe', timeoutMs)
  }

  public waitForUnsubscription(topic: string, timeoutMs = 1000): Promise<void> {
    const normalized = topic.trim()
    const bucket = this.topicListeners.get(normalized)
    if (!bucket || bucket.size === 0) {
      return Promise.resolve()
    }
    return this.createWaiter(normalized, 'unsubscribe', timeoutMs)
  }

  public getActiveSubscriptions(): string[] {
    return Array.from(this.topicListeners.keys())
  }

  public getListenerCount(topic?: string): number {
    if (topic !== undefined) {
      return this.topicListeners.get(topic.trim())?.size ?? 0
    }
    return this.getTotalTopicListenerCount()
  }

  public getSentFrames(): FakeTransportOutboundFrame[] {
    return [...this.sentFrames]
  }

  public clearSentFrames(): void {
    this.sentFrames.length = 0
  }

  /**
   * Asserts that all subscriptions, state/error listeners, pending waiters,
   * and tracked timers have been cleanly disposed after component unmount.
   */
  public assertCleanTeardown(): void {
    const activeTopics = this.getActiveSubscriptions()
    if (activeTopics.length > 0) {
      throw new Error(
        `FakeRealtimeTransport teardown leak: active topic subscriptions remain [${activeTopics.join(', ')}]`,
      )
    }
    if (this.stateListeners.size > 0) {
      throw new Error(
        `FakeRealtimeTransport teardown leak: ${this.stateListeners.size} state listener(s) still registered`,
      )
    }
    if (this.errorListeners.size > 0) {
      throw new Error(
        `FakeRealtimeTransport teardown leak: ${this.errorListeners.size} error listener(s) still registered`,
      )
    }
    if (this.activeTimers.size > 0) {
      throw new Error(
        `FakeRealtimeTransport teardown leak: ${this.activeTimers.size} timer(s) still active`,
      )
    }
    if (this.pendingWaiters.size > 0) {
      throw new Error(
        `FakeRealtimeTransport teardown leak: ${this.pendingWaiters.size} pending waiter(s) still unresolved`,
      )
    }
    if (this.connectRefCount > 0) {
      throw new Error(
        `FakeRealtimeTransport teardown leak: connectRefCount is ${this.connectRefCount} (expected 0)`,
      )
    }
  }

  private getTotalTopicListenerCount(): number {
    let total = 0
    for (const bucket of this.topicListeners.values()) {
      total += bucket.size
    }
    return total
  }

  private setState(
    nextState: FakeTransportConnectionState,
    closeInfo?: FakeTransportCloseInfo,
  ): void {
    this.state = nextState
    for (const listener of Array.from(this.stateListeners)) {
      listener(nextState, closeInfo)
    }
  }

  private createWaiter(
    topic: string,
    type: 'subscribe' | 'unsubscribe',
    timeoutMs: number,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const waiter: PendingWaiter = {
        topic,
        type,
        resolve: () => {
          if (waiter.timerId) {
            clearTimeout(waiter.timerId)
          }
          this.pendingWaiters.delete(waiter)
          resolve()
        },
        reject: (err: Error) => {
          if (waiter.timerId) {
            clearTimeout(waiter.timerId)
          }
          this.pendingWaiters.delete(waiter)
          reject(err)
        },
        timerId: null,
      }

      waiter.timerId = setTimeout(() => {
        waiter.reject(
          new Error(`Timed out waiting for ${type} on topic "${topic}" after ${timeoutMs}ms`),
        )
      }, timeoutMs)

      this.pendingWaiters.add(waiter)
    })
  }

  private resolveWaiters(topic: string, type: 'subscribe' | 'unsubscribe'): void {
    for (const waiter of Array.from(this.pendingWaiters)) {
      if (waiter.topic === topic && waiter.type === type) {
        waiter.resolve()
      }
    }
  }

  private clearAllTrackedTimers(): void {
    for (const timerId of this.activeTimers) {
      clearTimeout(timerId)
    }
    this.activeTimers.clear()
  }
}

/**
 * Helper to manage a group of subscriptions and listeners for a single hook/component mount cycle.
 * Safe across React 18 StrictMode mount -> unmount -> remount cycles.
 */
export function createFakeTransportMountScope(transport: FakeRealtimeTransport) {
  const cleanups: Array<() => void> = []
  let mounted = false

  return {
    mount<T = unknown>(
      topic: string,
      onEvent: FakeTopicListener<T>,
      options?: {
        onStateChange?: FakeStateListener
        onError?: FakeErrorListener
      },
    ): () => void {
      if (mounted) {
        this.unmount()
      }
      mounted = true
      cleanups.push(transport.connect())
      cleanups.push(transport.subscribe(topic, onEvent))
      if (options?.onStateChange) {
        cleanups.push(transport.onStateChange(options.onStateChange))
      }
      if (options?.onError) {
        cleanups.push(transport.onError(options.onError))
      }
      return () => this.unmount()
    },
    unmount(): void {
      if (!mounted) return
      mounted = false
      while (cleanups.length > 0) {
        const fn = cleanups.pop()
        fn?.()
      }
    },
  }
}

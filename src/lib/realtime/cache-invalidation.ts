/**
 * Declarative realtime topic-to-cache-key mapping and coalesced cache
 * invalidation bridge (#254).
 *
 * Connects inbound realtime push events to the shared cross-component cache
 * so hooks reading cached REST payloads refresh automatically without ad-hoc
 * per-hook mutation wiring.
 */

export interface RealtimePushCacheEvent<TPayload = unknown> {
  topic: string
  eventType?: string
  payload?: TPayload
  /**
   * When true, `payload` represents a complete authoritative entity that can be
   * written directly into the primary cache key in addition to notifying listeners.
   */
  authoritative?: boolean
}

export interface TopicCacheMapping {
  /** Primary cache key where an authoritative entity push can be written directly. */
  primaryKey: string
  /** All shared cache keys invalidated when an event arrives on this topic. */
  invalidatedKeys: string[]
}

/**
 * Declaratively resolves the shared REST cache keys affected by a realtime topic.
 */
export function resolveTopicCacheMapping(topic: string): TopicCacheMapping | null {
  const trimmed = topic.trim()
  if (!trimmed) return null

  const [rawFamily, rawScope] = trimmed.split(':', 2)
  const family = rawFamily.toLowerCase()
  const scope = rawScope?.trim()

  switch (family) {
    case 'oracle': {
      const primaryKey = scope
        ? `/api/oracle/readings/${scope}`
        : '/api/oracle/status'
      const invalidatedKeys = [
        '/api/oracle/status',
        '/api/oracle/readings',
        ...(scope ? [`/api/oracle/readings/${scope}`] : []),
      ]
      return { primaryKey, invalidatedKeys }
    }
    case 'claims': {
      const primaryKey = scope ? `/api/claims/wallet/${scope}` : '/api/claims'
      const invalidatedKeys = [
        '/api/claims',
        '/api/claims/recent',
        '/api/claims/stats',
        ...(scope ? [`/api/claims/wallet/${scope}`] : []),
      ]
      return { primaryKey, invalidatedKeys }
    }
    case 'pool': {
      const primaryKey = scope ? `/api/pool/${scope}/stats` : '/api/pool/stats'
      const invalidatedKeys = [
        '/api/pool/stats',
        '/api/pool/allocation',
        '/api/pool/position',
        ...(scope ? [`/api/pool/${scope}/stats`] : []),
      ]
      return { primaryKey, invalidatedKeys }
    }
    case 'notifications': {
      const primaryKey = scope
        ? `/api/notifications/${scope}`
        : '/api/notifications'
      const invalidatedKeys = [
        '/api/notifications',
        ...(scope ? [`/api/notifications/${scope}`] : []),
      ]
      return { primaryKey, invalidatedKeys }
    }
    default:
      return null
  }
}

export interface SharedCacheAdapter {
  get<T = unknown>(key: string): T | undefined
  set<T = unknown>(key: string, value: T): void
  invalidate(key: string): void
}

/**
 * Observable in-memory shared cache implementation compatible with cross-component
 * hook subscriptions and deterministic integration testing.
 */
export class InMemorySharedCache implements SharedCacheAdapter {
  private readonly store = new Map<string, unknown>()
  private readonly listeners = new Map<string, Set<() => void>>()
  public readonly invalidationHistory: string[] = []

  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T | undefined
  }

  set<T = unknown>(key: string, value: T): void {
    this.store.set(key, value)
    this.notifyKey(key)
  }

  invalidate(key: string): void {
    this.invalidationHistory.push(key)
    this.notifyKey(key)
  }

  subscribe(key: string, listener: () => void): () => void {
    let set = this.listeners.get(key)
    if (!set) {
      set = new Set()
      this.listeners.set(key, set)
    }
    set.add(listener)
    return () => {
      set?.delete(listener)
      if (set && set.size === 0) {
        this.listeners.delete(key)
      }
    }
  }

  private notifyKey(key: string): void {
    const set = this.listeners.get(key)
    if (!set) return
    for (const listener of Array.from(set)) {
      listener()
    }
  }
}

export interface RealtimeCacheInvalidatorOptions {
  /** Shared cache instance to invalidate/update. */
  cache: SharedCacheAdapter
  /** Whether the realtime layer is enabled (default: true when instantiated, no-op when false). */
  realtimeEnabled?: boolean
  /** Coalescing window in milliseconds to batch high-frequency invalidations (default: 50ms). */
  coalesceWindowMs?: number
}

export class RealtimeCacheInvalidator {
  private readonly cache: SharedCacheAdapter
  private realtimeEnabled: boolean
  private readonly coalesceWindowMs: number
  private readonly subscribedTopics = new Set<string>()
  private readonly pendingKeys = new Set<string>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: RealtimeCacheInvalidatorOptions) {
    this.cache = options.cache
    this.realtimeEnabled = options.realtimeEnabled ?? true
    this.coalesceWindowMs = Math.max(0, options.coalesceWindowMs ?? 50)
  }

  setRealtimeEnabled(enabled: boolean): void {
    this.realtimeEnabled = enabled
    if (!enabled) {
      this.cancelPendingFlush()
    }
  }

  isRealtimeEnabled(): boolean {
    return this.realtimeEnabled
  }

  registerSubscription(topic: string): void {
    const trimmed = topic.trim()
    if (trimmed) {
      this.subscribedTopics.add(trimmed)
    }
  }

  unregisterSubscription(topic: string): void {
    this.subscribedTopics.delete(topic.trim())
  }

  /**
   * Handles an inbound realtime event. Strict no-op if realtime is disabled or
   * if the client is not currently subscribed to `event.topic`.
   */
  handlePushEvent<TPayload = unknown>(event: RealtimePushCacheEvent<TPayload>): boolean {
    if (!this.realtimeEnabled) {
      return false
    }
    const topic = event.topic.trim()
    if (!this.subscribedTopics.has(topic)) {
      return false
    }

    const mapping = resolveTopicCacheMapping(topic)
    if (!mapping) {
      return false
    }

    // If the event carries a full authoritative entity, write it straight to the primary key
    if (event.authoritative && event.payload !== undefined) {
      this.cache.set(mapping.primaryKey, event.payload)
    }

    for (const key of mapping.invalidatedKeys) {
      if (event.authoritative && key === mapping.primaryKey) {
        continue
      }
      this.pendingKeys.add(key)
    }

    if (this.pendingKeys.size > 0) {
      this.scheduleFlush()
    }
    return true
  }

  /**
   * Immediately flushes any coalesced cache invalidations.
   */
  flushNow(): string[] {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (!this.realtimeEnabled || this.pendingKeys.size === 0) {
      this.pendingKeys.clear()
      return []
    }
    const keys = Array.from(this.pendingKeys)
    this.pendingKeys.clear()
    for (const key of keys) {
      this.cache.invalidate(key)
    }
    return keys
  }

  dispose(): void {
    this.cancelPendingFlush()
    this.subscribedTopics.clear()
  }

  private scheduleFlush(): void {
    if (this.coalesceWindowMs === 0) {
      this.flushNow()
      return
    }
    if (this.flushTimer !== null) {
      return
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushNow()
    }, this.coalesceWindowMs)
  }

  private cancelPendingFlush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.pendingKeys.clear()
  }
}

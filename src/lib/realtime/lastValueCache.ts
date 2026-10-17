export type RealtimeValueSource =
  | 'websocket'
  | 'sse'
  | 'polling'
  | 'soroban_rpc'
  | 'rest_snapshot'

export interface LastValueEntryMetadata {
  receivedAt?: number
  source?: RealtimeValueSource
  sequence?: number
  version?: number
}

export interface CachedTopicSnapshot<T = unknown> {
  topic: string
  value: T
  receivedAt: number
  ageMs: number
  source: RealtimeValueSource
  sequence?: number
  version?: number
  isCached: true
  isStale: boolean
}

export interface LastValueScope {
  walletAddress?: string | null
  network?: string | null
}

export interface LastValueTopicCacheOptions {
  /** Maximum number of topics retained in LRU cache (default: 100) */
  maxEntries?: number
  /** Hard TTL in milliseconds after which entries expire and are evicted (default: 60000) */
  ttlMs?: number
  /** Soft freshness threshold in ms after which `isStale` becomes true (default: ttlMs / 2) */
  staleAfterMs?: number
  /** Initial wallet/network scope */
  initialScope?: LastValueScope
  /** Clock function for deterministic tests */
  now?: () => number
}

interface InternalCacheRecord<T = unknown> {
  topic: string
  value: T
  receivedAt: number
  source: RealtimeValueSource
  sequence?: number
  version?: number
}

/**
 * Bounded LRU last-value cache per realtime topic so late-mounting components
 * can synchronously hydrate on their very first render frame.
 */
export class LastValueTopicCache {
  private readonly maxEntries: number
  private readonly ttlMs: number
  private readonly staleAfterMs: number
  private readonly now: () => number
  private readonly entries = new Map<string, InternalCacheRecord<unknown>>()
  private currentScopeKey: string

  constructor(options: LastValueTopicCacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 100)
    this.ttlMs = Math.max(1, options.ttlMs ?? 60_000)
    this.staleAfterMs = Math.max(
      1,
      options.staleAfterMs ?? Math.floor(this.ttlMs / 2),
    )
    this.now = options.now ?? (() => Date.now())
    this.currentScopeKey = this.serializeScope(options.initialScope)
  }

  /**
   * Synchronously reads the most recent value for `topic` if present and not expired.
   */
  public getLastValue<T = unknown>(topic: string): CachedTopicSnapshot<T> | null {
    const key = topic.trim()
    if (!key) return null

    const record = this.entries.get(key)
    if (!record) return null

    const currentTime = this.now()
    const ageMs = Math.max(0, currentTime - record.receivedAt)

    if (ageMs > this.ttlMs) {
      this.entries.delete(key)
      return null
    }

    // Refresh LRU position on read
    this.entries.delete(key)
    this.entries.set(key, record)

    return {
      topic: record.topic,
      value: record.value as T,
      receivedAt: record.receivedAt,
      ageMs,
      source: record.source,
      sequence: record.sequence,
      version: record.version,
      isCached: true,
      isStale: ageMs >= this.staleAfterMs,
    }
  }

  /**
   * Stores the latest value for `topic` while enforcing monotonic sequence/timestamp guards
   * and bounded LRU capacity.
   * Returns `true` if the value was stored, or `false` if rejected as stale out-of-order data.
   */
  public setLastValue<T = unknown>(
    topic: string,
    value: T,
    meta: LastValueEntryMetadata = {},
  ): boolean {
    const key = topic.trim()
    if (!key) {
      throw new Error('Topic must be a non-empty string')
    }

    const receivedAt = meta.receivedAt ?? this.now()
    const source = meta.source ?? 'websocket'
    const existing = this.entries.get(key)

    if (existing) {
      // Monotonic sequence guard when both entries carry sequence numbers
      if (
        meta.sequence !== undefined &&
        existing.sequence !== undefined &&
        meta.sequence < existing.sequence
      ) {
        return false
      }

      // Monotonic version guard when both entries carry version numbers
      if (
        meta.version !== undefined &&
        existing.version !== undefined &&
        meta.version < existing.version
      ) {
        return false
      }

      // Timestamp guard when sequence is not strictly newer
      const isSequenceNewer =
        meta.sequence !== undefined &&
        existing.sequence !== undefined &&
        meta.sequence > existing.sequence

      if (!isSequenceNewer && receivedAt < existing.receivedAt) {
        return false
      }
    }

    const record: InternalCacheRecord<T> = {
      topic: key,
      value,
      receivedAt,
      source,
      sequence: meta.sequence ?? existing?.sequence,
      version: meta.version ?? existing?.version,
    }

    if (this.entries.has(key)) {
      this.entries.delete(key)
    }
    this.entries.set(key, record)

    this.evictOverflow()
    return true
  }

  /**
   * Updates the active wallet/network scope and clears all cached topics
   * if the scope changed, preventing cross-account or cross-network flash.
   */
  public clearOnScopeChange(nextScope: LastValueScope): boolean {
    const nextKey = this.serializeScope(nextScope)
    if (nextKey === this.currentScopeKey) {
      return false
    }
    this.currentScopeKey = nextKey
    this.entries.clear()
    return true
  }

  public invalidateTopic(topic: string): boolean {
    return this.entries.delete(topic.trim())
  }

  public invalidatePrefix(prefix: string): number {
    const normalized = prefix.trim()
    let removed = 0
    for (const key of Array.from(this.entries.keys())) {
      if (key.startsWith(normalized)) {
        this.entries.delete(key)
        removed += 1
      }
    }
    return removed
  }

  public pruneExpired(): number {
    const currentTime = this.now()
    let removed = 0
    for (const [key, record] of Array.from(this.entries.entries())) {
      if (currentTime - record.receivedAt > this.ttlMs) {
        this.entries.delete(key)
        removed += 1
      }
    }
    return removed
  }

  public clear(): void {
    this.entries.clear()
  }

  public size(): number {
    return this.entries.size
  }

  public keys(): string[] {
    return Array.from(this.entries.keys())
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey === undefined) break
      this.entries.delete(oldestKey)
    }
  }

  private serializeScope(scope?: LastValueScope): string {
    const wallet = scope?.walletAddress?.trim().toLowerCase() ?? 'anon'
    const network = scope?.network?.trim().toLowerCase() ?? 'default'
    return `${network}::${wallet}`
  }
}

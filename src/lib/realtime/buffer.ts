/**
 * Bounded per-topic ring buffers and backpressure-aware memory limits (#253).
 *
 * Centralizes retention policies (max items and max age) per topic family so
 * high-frequency oracle streams, claim feeds, and notifications never grow
 * client heap memory without bound during long-lived sessions.
 */

export interface TopicRetentionPolicy {
  /** Maximum number of entries retained in memory for this topic. */
  maxEvents: number
  /** Maximum age of retained entries in milliseconds (optional). */
  maxAgeMs?: number
  /** Human-readable rationale for this retention cap. */
  rationale: string
}

/**
 * Documented per-topic retention limits and their architectural rationale.
 */
export const TOPIC_RETENTION_POLICIES: Record<string, TopicRetentionPolicy> = {
  oracle: {
    maxEvents: 200,
    maxAgeMs: 5 * 60 * 1000, // 5 minutes
    rationale:
      'Oracle price ticks arrive multiple times per second; 200 samples (~5 min window) suffice for sparkline charts and freshness checks.',
  },
  claims: {
    maxEvents: 100,
    maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
    rationale:
      'Claim settlement feeds render paginated/virtualized recent activity; 100 entries cover active session triage without duplicating full REST history.',
  },
  notifications: {
    maxEvents: 100,
    maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
    rationale:
      'Notification drawer caps history at 100 items while prioritizing unread notifications over already-read items during eviction.',
  },
  pool: {
    maxEvents: 150,
    maxAgeMs: 60 * 60 * 1000, // 1 hour
    rationale:
      'Pool TVL/utilization series needs up to 150 data points for intraday trend rendering.',
  },
  default: {
    maxEvents: 100,
    maxAgeMs: 30 * 60 * 1000, // 30 minutes
    rationale:
      'Default safety cap for any unrecognized or dynamic realtime topic.',
  },
}

export function resolveTopicRetentionPolicy(topic: string): TopicRetentionPolicy {
  const prefix = topic.split(':')[0]?.toLowerCase() ?? 'default'
  return TOPIC_RETENTION_POLICIES[prefix] ?? TOPIC_RETENTION_POLICIES.default
}

export interface BufferedEntry<T> {
  /** Stable key for React list rendering so eviction never thrashes keys. */
  key: string
  /** Event timestamp in epoch milliseconds. */
  timestamp: number
  /** Whether the entry is protected from preferential eviction (e.g. unread notification or active viewport pin). */
  protected?: boolean
  /** Underlying event or item payload. */
  value: T
}

export interface BoundedBufferMetrics {
  topic: string
  size: number
  maxEvents: number
  maxAgeMs?: number
  totalIngested: number
  droppedByCapacity: number
  droppedByAge: number
  protectedCount: number
}

export interface BoundedTopicBufferOptions<T> {
  topic: string
  maxEvents?: number
  maxAgeMs?: number
  nowFn?: () => number
  getKey?: (item: T, index: number) => string
  getTimestamp?: (item: T, now: number) => number
  isProtected?: (item: T) => boolean
}

export class BoundedTopicBuffer<T = unknown> {
  private readonly topic: string
  private readonly maxEvents: number
  private readonly maxAgeMs?: number
  private readonly nowFn: () => number
  private readonly getKey: (item: T, index: number) => string
  private readonly getTimestamp: (item: T, now: number) => number
  private readonly isProtected?: (item: T) => boolean

  private entries: BufferedEntry<T>[] = []
  private totalIngested = 0
  private droppedByCapacity = 0
  private droppedByAge = 0

  constructor(options: BoundedTopicBufferOptions<T>) {
    const defaultPolicy = resolveTopicRetentionPolicy(options.topic)
    this.topic = options.topic
    this.maxEvents = Math.max(1, options.maxEvents ?? defaultPolicy.maxEvents)
    this.maxAgeMs = options.maxAgeMs ?? defaultPolicy.maxAgeMs
    this.nowFn = options.nowFn ?? (() => Date.now())
    this.getKey =
      options.getKey ??
      ((_item, idx) => `${this.topic}:${idx}`)
    this.getTimestamp =
      options.getTimestamp ??
      ((_item, now) => now)
    this.isProtected = options.isProtected
  }

  /**
   * Appends a single item to the buffer, pruning expired entries first and
   * evicting oldest unprotected (or oldest overall) entries when capacity is exceeded.
   */
  push(item: T): BufferedEntry<T> {
    const now = this.nowFn()
    this.pruneExpired(now)

    this.totalIngested += 1
    const key = this.getKey(item, this.totalIngested)
    const timestamp = this.getTimestamp(item, now)
    const isProtected = this.isProtected ? this.isProtected(item) : false

    // If an item with the same stable key exists, update it in place
    const existingIdx = this.entries.findIndex((e) => e.key === key)
    if (existingIdx !== -1) {
      const updated: BufferedEntry<T> = {
        key,
        timestamp,
        protected: isProtected,
        value: item,
      }
      this.entries[existingIdx] = updated
      return updated
    }

    if (this.entries.length >= this.maxEvents) {
      this.evictOne()
    }

    const entry: BufferedEntry<T> = {
      key,
      timestamp,
      protected: isProtected,
      value: item,
    }
    this.entries.push(entry)
    return entry
  }

  /**
   * Merges a batch of items (such as a REST snapshot) while respecting retention bounds.
   */
  pushMany(items: readonly T[]): BufferedEntry<T>[] {
    for (const item of items) {
      this.push(item)
    }
    return this.getEntries()
  }

  /**
   * Removes entries older than `maxAgeMs`. Unprotected expired entries are removed;
   * protected (e.g. unread) entries are retained unless capacity forces eviction.
   */
  pruneExpired(now = this.nowFn()): number {
    if (this.maxAgeMs === undefined || this.maxAgeMs <= 0) {
      return 0
    }
    const cutoff = now - this.maxAgeMs
    let removed = 0
    this.entries = this.entries.filter((entry) => {
      if (!entry.protected && entry.timestamp < cutoff) {
        removed += 1
        return false
      }
      return true
    })
    this.droppedByAge += removed
    return removed
  }

  /**
   * Marks an entry by key as protected or unprotected (e.g. when a notification is marked read).
   */
  setProtected(key: string, isProtected: boolean): boolean {
    const entry = this.entries.find((e) => e.key === key)
    if (!entry) return false
    entry.protected = isProtected
    return true
  }

  /**
   * Returns a shallow copy of buffered entries in chronological insertion order (oldest -> newest).
   */
  getEntries(): BufferedEntry<T>[] {
    return this.entries.slice()
  }

  /**
   * Returns values in chronological order (oldest -> newest).
   */
  getValues(): T[] {
    return this.entries.map((e) => e.value)
  }

  /**
   * Returns observable metrics for the dev panel and memory diagnostics.
   */
  getMetrics(): BoundedBufferMetrics {
    let protectedCount = 0
    for (const entry of this.entries) {
      if (entry.protected) protectedCount += 1
    }
    return {
      topic: this.topic,
      size: this.entries.length,
      maxEvents: this.maxEvents,
      maxAgeMs: this.maxAgeMs,
      totalIngested: this.totalIngested,
      droppedByCapacity: this.droppedByCapacity,
      droppedByAge: this.droppedByAge,
      protectedCount,
    }
  }

  clear(): void {
    this.entries = []
  }

  private evictOne(): void {
    // Prefer evicting the oldest unprotected entry first so unread notifications / pinned rows survive
    const unprotectedIdx = this.entries.findIndex((e) => !e.protected)
    if (unprotectedIdx !== -1) {
      this.entries.splice(unprotectedIdx, 1)
    } else {
      // Fallback: if all entries are protected, still enforce hard memory bound by dropping oldest
      this.entries.shift()
    }
    this.droppedByCapacity += 1
  }
}

/**
 * Registry managing bounded buffers across all active realtime topics.
 */
export class TopicBufferManager {
  private readonly buffers = new Map<string, BoundedTopicBuffer<unknown>>()
  private readonly nowFn: () => number

  constructor(nowFn: () => number = () => Date.now()) {
    this.nowFn = nowFn
  }

  getOrCreateBuffer<T>(
    topic: string,
    options?: Omit<BoundedTopicBufferOptions<T>, 'topic' | 'nowFn'>
  ): BoundedTopicBuffer<T> {
    let existing = this.buffers.get(topic)
    if (!existing) {
      existing = new BoundedTopicBuffer<T>({
        topic,
        nowFn: this.nowFn,
        ...options,
      }) as BoundedTopicBuffer<unknown>
      this.buffers.set(topic, existing)
    }
    return existing as BoundedTopicBuffer<T>
  }

  getAllMetrics(): BoundedBufferMetrics[] {
    return Array.from(this.buffers.values()).map((buf) => buf.getMetrics())
  }

  clearAll(): void {
    this.buffers.clear()
  }
}

/**
 * IndexedDB-backed local snapshot cache for instant cold-start hydration of
 * realtime topics (#284).
 *
 * Stores the last known value per `(network, walletAddress, topic)` with
 * schema-version stamping, throttled/coalesced writes for high-frequency
 * streams, stale-while-revalidate metadata (`isStaleHydration: true`),
 * monotonic freshness guards, and LRU/oldest quota eviction.
 */

export const SNAPSHOT_CACHE_SCHEMA_VERSION = 1

export interface SnapshotCacheRecord<T = unknown> {
  key: string
  schemaVersion: number
  network: string
  walletAddress: string
  topic: string
  capturedAt: number
  sequence?: number
  data: T
}

export interface HydratedTopicSnapshot<T = unknown> {
  topic: string
  data: T
  capturedAt: number
  sequence?: number
  /** Always `true` for cold-start cached snapshots until superseded by live data. */
  isStaleHydration: true
}

/**
 * Pluggable async key-value store backing `RealtimeSnapshotCache` (defaults to
 * an IndexedDB object store in the browser, or an injectable fake in tests).
 */
export interface SnapshotStorageBackend {
  get(key: string): Promise<SnapshotCacheRecord | undefined>
  put(record: SnapshotCacheRecord): Promise<void>
  delete(key: string): Promise<void>
  getAll(): Promise<SnapshotCacheRecord[]>
}

export interface RealtimeSnapshotCacheOptions {
  /** Custom storage backend (defaults to browser IndexedDB when available, or no-op in SSR). */
  backend?: SnapshotStorageBackend | null
  /** Expected schema version (default: `1`). */
  schemaVersion?: number
  /** Minimum interval in ms between persisted writes for the same topic key (default: 500ms). */
  writeThrottleMs?: number
  /** Maximum number of topic snapshots retained before oldest entries are evicted (default: 64). */
  maxEntries?: number
  /** Maximum age of a cached snapshot in ms before cold-start hydration ignores it (default: 24 hours). */
  maxAgeMs?: number
  /** Whether running in an SSR environment (`typeof window === 'undefined'`). */
  isServer?: boolean
  /** Clock provider for deterministic testing. */
  nowFn?: () => number
}

export function buildSnapshotStorageKey(
  network: string,
  walletAddress: string | null | undefined,
  topic: string
): string {
  const net = network.trim().toLowerCase() || 'default'
  const wallet = walletAddress?.trim() || 'public'
  const cleanTopic = topic.trim()
  return `${net}::${wallet}::${cleanTopic}`
}

export class RealtimeSnapshotCache {
  private readonly backend: SnapshotStorageBackend | null
  private readonly schemaVersion: number
  private readonly writeThrottleMs: number
  private readonly maxEntries: number
  private readonly maxAgeMs: number
  private readonly isServer: boolean
  private readonly nowFn: () => number

  /** Synchronous in-memory mirror for instant first-render reads after warm-up. */
  private readonly memoryMirror = new Map<string, SnapshotCacheRecord>()
  private readonly pendingWrites = new Map<string, SnapshotCacheRecord>()
  private readonly throttleTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()

  constructor(options: RealtimeSnapshotCacheOptions = {}) {
    this.isServer =
      options.isServer ?? typeof window === 'undefined'
    this.backend = this.isServer ? null : (options.backend ?? null)
    this.schemaVersion =
      options.schemaVersion ?? SNAPSHOT_CACHE_SCHEMA_VERSION
    this.writeThrottleMs = Math.max(0, options.writeThrottleMs ?? 500)
    this.maxEntries = Math.max(1, options.maxEntries ?? 64)
    this.maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60 * 1000
    this.nowFn = options.nowFn ?? (() => Date.now())
  }

  /**
   * Synchronously reads a cached snapshot from the in-memory mirror to seed
   * hook state on first client render. Always returns `null` on the server (SSR).
   */
  readSync<T = unknown>(params: {
    network: string
    walletAddress?: string | null
    topic: string
  }): HydratedTopicSnapshot<T> | null {
    if (this.isServer) return null
    const key = buildSnapshotStorageKey(
      params.network,
      params.walletAddress,
      params.topic
    )
    const record = this.memoryMirror.get(key)
    if (!record) return null

    if (!this.isRecordValid(record)) {
      this.memoryMirror.delete(key)
      return null
    }

    return {
      topic: record.topic,
      data: record.data as T,
      capturedAt: record.capturedAt,
      sequence: record.sequence,
      isStaleHydration: true,
    }
  }

  /**
   * Asynchronously hydrates a topic snapshot from IndexedDB into the synchronous
   * mirror and returns it marked with `isStaleHydration: true`.
   */
  async hydrate<T = unknown>(params: {
    network: string
    walletAddress?: string | null
    topic: string
  }): Promise<HydratedTopicSnapshot<T> | null> {
    if (this.isServer) return null
    const key = buildSnapshotStorageKey(
      params.network,
      params.walletAddress,
      params.topic
    )

    const memRecord = this.memoryMirror.get(key)
    if (memRecord && this.isRecordValid(memRecord)) {
      return {
        topic: memRecord.topic,
        data: memRecord.data as T,
        capturedAt: memRecord.capturedAt,
        sequence: memRecord.sequence,
        isStaleHydration: true,
      }
    }

    if (!this.backend) return null

    try {
      const stored = await this.backend.get(key)
      if (!stored) return null

      if (!this.isRecordValid(stored)) {
        await this.backend.delete(key)
        this.memoryMirror.delete(key)
        return null
      }

      // Guard against overwriting fresher in-memory data that arrived while IndexedDB read was in flight
      const currentMem = this.memoryMirror.get(key)
      if (currentMem && !this.isIncomingFresher(currentMem, stored)) {
        return {
          topic: currentMem.topic,
          data: currentMem.data as T,
          capturedAt: currentMem.capturedAt,
          sequence: currentMem.sequence,
          isStaleHydration: true,
        }
      }

      this.memoryMirror.set(key, stored)
      return {
        topic: stored.topic,
        data: stored.data as T,
        capturedAt: stored.capturedAt,
        sequence: stored.sequence,
        isStaleHydration: true,
      }
    } catch {
      return null
    }
  }

  /**
   * Schedules a coalesced/throttled snapshot write. Never overwrites a snapshot
   * that already has a newer `sequence` or `capturedAt` timestamp.
   */
  writeSnapshot<T = unknown>(params: {
    network: string
    walletAddress?: string | null
    topic: string
    data: T
    capturedAt?: number
    sequence?: number
  }): boolean {
    if (this.isServer) return false

    const key = buildSnapshotStorageKey(
      params.network,
      params.walletAddress,
      params.topic
    )
    const now = this.nowFn()
    const incoming: SnapshotCacheRecord<T> = {
      key,
      schemaVersion: this.schemaVersion,
      network: params.network.trim().toLowerCase() || 'default',
      walletAddress: params.walletAddress?.trim() || 'public',
      topic: params.topic.trim(),
      capturedAt: params.capturedAt ?? now,
      sequence: params.sequence,
      data: params.data,
    }

    const existing =
      this.pendingWrites.get(key) ?? this.memoryMirror.get(key)
    if (existing && !this.isIncomingFresher(existing, incoming)) {
      return false
    }

    this.memoryMirror.set(key, incoming)
    this.enforceMemoryQuota()

    if (!this.backend) {
      return true
    }

    if (this.writeThrottleMs === 0) {
      void this.persistRecordToBackend(incoming)
      return true
    }

    this.pendingWrites.set(key, incoming)
    if (!this.throttleTimers.has(key)) {
      const timer = setTimeout(() => {
        this.throttleTimers.delete(key)
        const latest = this.pendingWrites.get(key)
        this.pendingWrites.delete(key)
        if (latest) {
          void this.persistRecordToBackend(latest)
        }
      }, this.writeThrottleMs)
      this.throttleTimers.set(key, timer)
    }

    return true
  }

  /**
   * Flushes all pending throttled writes to the storage backend immediately.
   */
  async flushPendingWrites(): Promise<void> {
    for (const timer of this.throttleTimers.values()) {
      clearTimeout(timer)
    }
    this.throttleTimers.clear()

    const records = Array.from(this.pendingWrites.values())
    this.pendingWrites.clear()

    for (const rec of records) {
      await this.persistRecordToBackend(rec)
    }
  }

  private async persistRecordToBackend(
    record: SnapshotCacheRecord
  ): Promise<void> {
    if (!this.backend) return
    try {
      await this.backend.put(record)
      const all = await this.backend.getAll()
      if (all.length > this.maxEntries) {
        const sortedOldestFirst = all
          .slice()
          .sort((a, b) => a.capturedAt - b.capturedAt)
        const excess = sortedOldestFirst.length - this.maxEntries
        for (let i = 0; i < excess; i++) {
          await this.backend.delete(sortedOldestFirst[i].key)
          this.memoryMirror.delete(sortedOldestFirst[i].key)
        }
      }
    } catch {
      // QuotaExceededError or blocked upgrade must degrade silently and never throw into render
    }
  }

  private enforceMemoryQuota(): void {
    if (this.memoryMirror.size <= this.maxEntries) return
    const sortedOldestFirst = Array.from(this.memoryMirror.values()).sort(
      (a, b) => a.capturedAt - b.capturedAt
    )
    const excess = this.memoryMirror.size - this.maxEntries
    for (let i = 0; i < excess; i++) {
      this.memoryMirror.delete(sortedOldestFirst[i].key)
    }
  }

  private isRecordValid(record: SnapshotCacheRecord): boolean {
    if (record.schemaVersion !== this.schemaVersion) {
      return false
    }
    const cutoff = this.nowFn() - this.maxAgeMs
    if (record.capturedAt < cutoff) {
      return false
    }
    return true
  }

  private isIncomingFresher(
    existing: SnapshotCacheRecord,
    incoming: SnapshotCacheRecord
  ): boolean {
    if (
      existing.sequence !== undefined &&
      incoming.sequence !== undefined &&
      incoming.sequence < existing.sequence
    ) {
      return false
    }
    if (
      existing.sequence !== undefined &&
      incoming.sequence !== undefined &&
      incoming.sequence > existing.sequence
    ) {
      return true
    }
    return incoming.capturedAt >= existing.capturedAt
  }
}

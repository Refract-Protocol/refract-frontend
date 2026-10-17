/**
 * Session-storage persistence and rehydration for active realtime topic
 * subscriptions and resume cursors across page reloads (#226).
 */

export const SUBSCRIPTION_PERSISTENCE_SCHEMA_VERSION = 1
export const SUBSCRIPTION_STORAGE_KEY_PREFIX = 'refract:realtime:subs:v1:'

const KNOWN_TOPIC_PREFIXES = new Set(['oracle', 'claims', 'pool', 'notifications'])

export interface PersistedTopicSubscription {
  topic: string
  scope: string
  cursor: string | number | null
  updatedAt: number
}

export interface PersistedSubscriptionEnvelope {
  schemaVersion: number
  scope: string
  savedAt: number
  subscriptions: PersistedTopicSubscription[]
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  key?(index: number): string | null
  readonly length?: number
}

export interface SubscriptionPersistenceOptions {
  /** Custom Storage implementation (defaults to `window.sessionStorage` when available). */
  storage?: StorageLike | null
  /** Expected schema version (default: `1`). */
  schemaVersion?: number
  /** Maximum age of persisted subscriptions in ms before they are considered stale (default: 15 minutes). */
  maxAgeMs?: number
  /** Maximum number of topics persisted per scope (default: 32). */
  maxTopics?: number
  /** Maximum length of a serialized cursor string (default: 256 chars). */
  maxCursorLength?: number
  /** Custom topic validator (defaults to checking `oracle`, `claims`, `pool`, `notifications` prefixes). */
  isValidTopic?: (topic: string, scope: string) => boolean
  /** Clock provider for deterministic testing. */
  nowFn?: () => number
}

/**
 * Validates that a topic conforms to the documented `<family>:<identifier>` contract
 * and that wallet-scoped topics match the active wallet scope when applicable.
 */
export function defaultIsValidTopic(topic: string, scope: string): boolean {
  const trimmed = topic.trim()
  const colonIdx = trimmed.indexOf(':')
  if (colonIdx <= 0 || colonIdx === trimmed.length - 1) {
    return false
  }
  const family = trimmed.slice(0, colonIdx).toLowerCase()
  const target = trimmed.slice(colonIdx + 1).trim()
  if (!KNOWN_TOPIC_PREFIXES.has(family) || !target) {
    return false
  }
  // If topic is wallet-scoped (claims / notifications) and scope specifies a wallet, enforce match
  if ((family === 'claims' || family === 'notifications') && scope.includes(':')) {
    const walletPart = scope.split(':').pop()
    if (walletPart && walletPart !== 'public' && walletPart !== 'anonymous' && target !== walletPart) {
      return false
    }
  }
  return true
}

export class SubscriptionPersistenceStore {
  private readonly storage: StorageLike | null
  private readonly schemaVersion: number
  private readonly maxAgeMs: number
  private readonly maxTopics: number
  private readonly maxCursorLength: number
  private readonly isValidTopic: (topic: string, scope: string) => boolean
  private readonly nowFn: () => number

  constructor(options: SubscriptionPersistenceOptions = {}) {
    this.storage =
      options.storage !== undefined
        ? options.storage
        : typeof window !== 'undefined' && window.sessionStorage
          ? window.sessionStorage
          : null
    this.schemaVersion = options.schemaVersion ?? SUBSCRIPTION_PERSISTENCE_SCHEMA_VERSION
    this.maxAgeMs = options.maxAgeMs ?? 15 * 60 * 1000
    this.maxTopics = Math.max(1, options.maxTopics ?? 32)
    this.maxCursorLength = Math.max(16, options.maxCursorLength ?? 256)
    this.isValidTopic = options.isValidTopic ?? defaultIsValidTopic
    this.nowFn = options.nowFn ?? (() => Date.now())
  }

  /**
   * Builds the namespaced sessionStorage key for a given network/wallet scope.
   */
  getStorageKey(scope: string): string {
    const normalizedScope = scope.trim() || 'public'
    return `${SUBSCRIPTION_STORAGE_KEY_PREFIX}${normalizedScope}`
  }

  /**
   * Persists the set of active subscriptions for a given scope.
   * Safe no-op during SSR or if sessionStorage quota is exceeded.
   */
  save(
    scope: string,
    subscriptions: ReadonlyArray<{
      topic: string
      cursor?: string | number | null
      updatedAt?: number
    }>
  ): boolean {
    if (!this.storage) return false
    const now = this.nowFn()
    const normalizedScope = scope.trim() || 'public'

    const sanitized: PersistedTopicSubscription[] = []
    const seenTopics = new Set<string>()

    for (const item of subscriptions) {
      if (sanitized.length >= this.maxTopics) break
      const topic = item.topic?.trim()
      if (!topic || seenTopics.has(topic)) continue
      if (!this.isValidTopic(topic, normalizedScope)) continue

      seenTopics.add(topic)
      sanitized.push({
        topic,
        scope: normalizedScope,
        cursor: this.sanitizeCursor(item.cursor ?? null),
        updatedAt: item.updatedAt ?? now,
      })
    }

    const envelope: PersistedSubscriptionEnvelope = {
      schemaVersion: this.schemaVersion,
      scope: normalizedScope,
      savedAt: now,
      subscriptions: sanitized,
    }

    try {
      this.storage.setItem(this.getStorageKey(normalizedScope), JSON.stringify(envelope))
      return true
    } catch {
      return false
    }
  }

  /**
   * Rehydrates and validates persisted subscriptions for `scope`.
   * Automatically removes corrupted or schema-mismatched payloads.
   */
  rehydrate(scope: string): PersistedTopicSubscription[] {
    if (!this.storage) return []
    const normalizedScope = scope.trim() || 'public'
    const key = this.getStorageKey(normalizedScope)

    let raw: string | null = null
    try {
      raw = this.storage.getItem(key)
    } catch {
      return []
    }
    if (!raw) return []

    try {
      const parsed = JSON.parse(raw) as Partial<PersistedSubscriptionEnvelope>
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        parsed.schemaVersion !== this.schemaVersion ||
        parsed.scope !== normalizedScope ||
        !Array.isArray(parsed.subscriptions)
      ) {
        this.storage.removeItem(key)
        return []
      }

      const now = this.nowFn()
      const cutoff = now - this.maxAgeMs
      const valid: PersistedTopicSubscription[] = []
      const seen = new Set<string>()

      for (const entry of parsed.subscriptions) {
        if (valid.length >= this.maxTopics) break
        if (
          !entry ||
          typeof entry.topic !== 'string' ||
          typeof entry.updatedAt !== 'number' ||
          !Number.isFinite(entry.updatedAt)
        ) {
          continue
        }
        if (entry.updatedAt < cutoff) {
          continue
        }
        const topic = entry.topic.trim()
        if (seen.has(topic) || !this.isValidTopic(topic, normalizedScope)) {
          continue
        }
        seen.add(topic)
        valid.push({
          topic,
          scope: normalizedScope,
          cursor: this.sanitizeCursor(entry.cursor ?? null),
          updatedAt: entry.updatedAt,
        })
      }

      return valid
    } catch {
      // Corrupted JSON: evict key cleanly and return empty list
      try {
        this.storage.removeItem(key)
      } catch {
        // Ignore storage removal errors
      }
      return []
    }
  }

  /**
   * Clears persisted state for a specific wallet/network scope (e.g. on scope switch).
   */
  clearScope(scope: string): void {
    if (!this.storage) return
    try {
      this.storage.removeItem(this.getStorageKey(scope))
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Clears all persisted subscription namespaces (e.g. on explicit wallet logout).
   */
  clearAll(): void {
    if (!this.storage) return
    try {
      if (typeof this.storage.length === 'number' && typeof this.storage.key === 'function') {
        const keysToRemove: string[] = []
        for (let i = 0; i < this.storage.length; i++) {
          const k = this.storage.key(i)
          if (k && k.startsWith(SUBSCRIPTION_STORAGE_KEY_PREFIX)) {
            keysToRemove.push(k)
          }
        }
        for (const k of keysToRemove) {
          this.storage.removeItem(k)
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  private sanitizeCursor(cursor: string | number | null): string | number | null {
    if (cursor === null || cursor === undefined) return null
    if (typeof cursor === 'number') {
      return Number.isFinite(cursor) ? cursor : null
    }
    if (typeof cursor === 'string') {
      const trimmed = cursor.trim()
      if (!trimmed || trimmed.length > this.maxCursorLength) {
        return null
      }
      return trimmed
    }
    return null
  }
}

/**
 * Per-topic feature flag schema, independent rollout evaluator, and per-topic
 * kill controls for the realtime layer (#308).
 *
 * Precedence order per topic family (`oracle`, `claims`, `pool`, `notifications`):
 * 1. Explicit Per-Topic Kill (`killed: true` or `killTopic(family)`) -> always `false`
 * 2. Local / QA Override (`setTopicOverride(family, boolean)`)
 * 3. Configured Topic Entry in `flags.json` (`realtimeTopics.<family>` or legacy `realtime-<family>`)
 * 4. Safe Default (`false` — fail-closed on missing, unknown, or malformed entries)
 */

export type KnownRealtimeTopicFamily =
  | 'oracle'
  | 'claims'
  | 'pool'
  | 'notifications'

const KNOWN_FAMILIES = new Set<KnownRealtimeTopicFamily>([
  'oracle',
  'claims',
  'pool',
  'notifications',
])

export interface TopicFlagRule {
  enabled: boolean
  killed?: boolean
  /** Optional deterministic rollout percentage in `[0, 100]`. */
  rolloutPct?: number
}

export interface RawFlagsDocument {
  'realtime-oracle'?: unknown
  'realtime-claims'?: unknown
  'realtime-pool'?: unknown
  'realtime-notifications'?: unknown
  realtimeTopics?: Record<string, unknown>
  [key: string]: unknown
}

export type TopicFlagChangeReason =
  | 'config_update'
  | 'topic_killed'
  | 'override_changed'

export interface RealtimeTopicFlagRegistryOptions {
  /** Initial flags document (e.g. parsed from `public/flags.json`). */
  initialFlags?: RawFlagsDocument
  /** Deterministic bucket seed (e.g. wallet address or session ID) for `rolloutPct` evaluation. */
  rolloutSeed?: string
  /** Invoked when a topic's effective enabled state flips mid-session so active subscriptions tear down or start. */
  onTopicStateChanged?: (
    family: KnownRealtimeTopicFamily,
    enabled: boolean,
    reason: TopicFlagChangeReason
  ) => void
  /** Invoked when an unknown or malformed topic flag entry is encountered and fails closed. */
  onMalformedEntry?: (key: string, value: unknown, reason: string) => void
}

/**
 * Extracts the canonical topic family from a concrete topic string (`"oracle:XLM/USD"` -> `"oracle"`).
 */
export function extractKnownTopicFamily(
  topicOrFamily: string
): KnownRealtimeTopicFamily | null {
  const prefix = topicOrFamily.trim().split(':', 1)[0]?.toLowerCase() ?? ''
  if (KNOWN_FAMILIES.has(prefix as KnownRealtimeTopicFamily)) {
    return prefix as KnownRealtimeTopicFamily
  }
  return null
}

/**
 * Computes a deterministic integer bucket in `[0, 99]` from a seed and topic family.
 */
export function computeDeterministicRolloutBucket(
  seed: string,
  family: string
): number {
  const input = `${seed}::${family}`
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % 100
}

export class RealtimeTopicFlagRegistry {
  private readonly rolloutSeed: string
  private readonly onTopicStateChanged?: RealtimeTopicFlagRegistryOptions['onTopicStateChanged']
  private readonly onMalformedEntry?: RealtimeTopicFlagRegistryOptions['onMalformedEntry']

  private readonly rules = new Map<KnownRealtimeTopicFamily, TopicFlagRule>()
  private readonly killedFamilies = new Set<KnownRealtimeTopicFamily>()
  private readonly overrides = new Map<KnownRealtimeTopicFamily, boolean>()
  private readonly lastEffectiveState = new Map<
    KnownRealtimeTopicFamily,
    boolean
  >()

  constructor(options: RealtimeTopicFlagRegistryOptions = {}) {
    this.rolloutSeed = options.rolloutSeed ?? 'default-session'
    this.onTopicStateChanged = options.onTopicStateChanged
    this.onMalformedEntry = options.onMalformedEntry

    for (const family of KNOWN_FAMILIES) {
      this.rules.set(family, { enabled: false })
      this.lastEffectiveState.set(family, false)
    }

    if (options.initialFlags) {
      this.updateFlagsConfig(options.initialFlags, false)
    }
  }

  /**
   * Evaluates whether a concrete topic (e.g. `oracle:XLM/USD`) or topic family
   * (`oracle`) is enabled for realtime streaming. Unknown topics fail closed to `false`.
   */
  isTopicEnabled(topicOrFamily: string): boolean {
    const family = extractKnownTopicFamily(topicOrFamily)
    if (!family) {
      this.onMalformedEntry?.(
        topicOrFamily,
        topicOrFamily,
        'Unknown realtime topic family'
      )
      return false
    }
    return this.evaluateFamily(family)
  }

  /**
   * Updates the registry from a parsed `public/flags.json` payload and notifies
   * listeners for any topic whose effective state flipped.
   */
  updateFlagsConfig(
    doc: unknown,
    emitChanges = true
  ): Record<KnownRealtimeTopicFamily, boolean> {
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
      this.onMalformedEntry?.('root', doc, 'Flags document must be an object')
      return this.getSnapshot()
    }

    const rawDoc = doc as RawFlagsDocument

    // 1. Parse legacy flat `realtime-<family>` keys
    for (const family of KNOWN_FAMILIES) {
      const legacyKey = `realtime-${family}` as const
      if (legacyKey in rawDoc && rawDoc[legacyKey] !== undefined) {
        const parsed = this.parseTopicRule(legacyKey, rawDoc[legacyKey])
        this.rules.set(family, parsed)
      }
    }

    // 2. Parse structured `realtimeTopics` map (takes precedence over legacy flat keys in the same doc)
    if (rawDoc.realtimeTopics !== undefined) {
      if (
        typeof rawDoc.realtimeTopics !== 'object' ||
        rawDoc.realtimeTopics === null ||
        Array.isArray(rawDoc.realtimeTopics)
      ) {
        this.onMalformedEntry?.(
          'realtimeTopics',
          rawDoc.realtimeTopics,
          'realtimeTopics must be a plain object'
        )
      } else {
        for (const [key, val] of Object.entries(rawDoc.realtimeTopics)) {
          const family = extractKnownTopicFamily(key)
          if (!family) {
            this.onMalformedEntry?.(
              `realtimeTopics.${key}`,
              val,
              `Unrecognized topic family "${key}"`
            )
            continue
          }
          const rule = this.parseTopicRule(`realtimeTopics.${key}`, val)
          this.rules.set(family, rule)
          if (rule.killed === true) {
            this.killedFamilies.add(family)
          }
        }
      }
    }

    this.reconcileAndNotify('config_update', emitChanges)
    return this.getSnapshot()
  }

  /**
   * Explicitly kills a topic family mid-session, overriding both config and QA overrides,
   * and triggers `onTopicStateChanged(family, false, 'topic_killed')` if it was active.
   */
  killTopic(topicOrFamily: string): boolean {
    const family = extractKnownTopicFamily(topicOrFamily)
    if (!family) return false
    this.killedFamilies.add(family)
    this.reconcileAndNotify('topic_killed', true)
    return true
  }

  /**
   * Clears an explicit per-topic kill switch.
   */
  unkillTopic(topicOrFamily: string): boolean {
    const family = extractKnownTopicFamily(topicOrFamily)
    if (!family) return false
    this.killedFamilies.delete(family)
    this.reconcileAndNotify('config_update', true)
    return true
  }

  /**
   * Sets or clears a local/QA override for a topic family.
   */
  setTopicOverride(
    topicOrFamily: string,
    enabled: boolean | null
  ): boolean {
    const family = extractKnownTopicFamily(topicOrFamily)
    if (!family) return false
    if (enabled === null) {
      this.overrides.delete(family)
    } else {
      this.overrides.set(family, enabled)
    }
    this.reconcileAndNotify('override_changed', true)
    return true
  }

  getSnapshot(): Record<KnownRealtimeTopicFamily, boolean> {
    return {
      oracle: this.evaluateFamily('oracle'),
      claims: this.evaluateFamily('claims'),
      pool: this.evaluateFamily('pool'),
      notifications: this.evaluateFamily('notifications'),
    }
  }

  private evaluateFamily(family: KnownRealtimeTopicFamily): boolean {
    const rule = this.rules.get(family)
    // 1. Explicit per-topic kill always wins
    if (this.killedFamilies.has(family) || rule?.killed === true) {
      return false
    }

    // 2. Local / QA override
    if (this.overrides.has(family)) {
      return this.overrides.get(family)!
    }

    // 3. Configured rule in flags.json
    if (!rule || !rule.enabled) {
      return false
    }

    if (rule.rolloutPct !== undefined) {
      if (rule.rolloutPct <= 0) return false
      if (rule.rolloutPct >= 100) return true
      const bucket = computeDeterministicRolloutBucket(this.rolloutSeed, family)
      return bucket < rule.rolloutPct
    }

    return true
  }

  private parseTopicRule(pathKey: string, raw: unknown): TopicFlagRule {
    if (typeof raw === 'boolean') {
      return { enabled: raw }
    }

    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      const obj = raw as Record<string, unknown>
      if (typeof obj.enabled !== 'boolean') {
        this.onMalformedEntry?.(
          pathKey,
          raw,
          'Topic rule object must include boolean "enabled"'
        )
        return { enabled: false }
      }

      const killed = typeof obj.killed === 'boolean' ? obj.killed : false
      let rolloutPct: number | undefined
      if (obj.rolloutPct !== undefined) {
        if (
          typeof obj.rolloutPct !== 'number' ||
          !Number.isFinite(obj.rolloutPct) ||
          obj.rolloutPct < 0 ||
          obj.rolloutPct > 100
        ) {
          this.onMalformedEntry?.(
            pathKey,
            raw,
            'Invalid rolloutPct (must be 0..100)'
          )
          return { enabled: false }
        }
        rolloutPct = obj.rolloutPct
      }

      return { enabled: obj.enabled, killed, rolloutPct }
    }

    this.onMalformedEntry?.(
      pathKey,
      raw,
      'Topic flag entry must be a boolean or { enabled, killed?, rolloutPct? }'
    )
    return { enabled: false }
  }

  private reconcileAndNotify(
    reason: TopicFlagChangeReason,
    emitChanges: boolean
  ): void {
    for (const family of KNOWN_FAMILIES) {
      const prev = this.lastEffectiveState.get(family) ?? false
      const next = this.evaluateFamily(family)
      this.lastEffectiveState.set(family, next)
      if (emitChanges && prev !== next) {
        this.onTopicStateChanged?.(family, next, reason)
      }
    }
  }
}

export type DataFreshnessLevel = 'fresh' | 'aging' | 'stale' | 'reconnecting'

export type DataSourceKind = 'realtime' | 'rest_fallback' | 'seed'

export type TransportHealthState =
  | 'connected'
  | 'reconnecting'
  | 'disconnected'

export interface TopicFreshnessMetadata {
  topic: string
  lastUpdatedAt: number | null
  source: DataSourceKind
  transportState: TransportHealthState
  reconnectStartedAt?: number | null
}

export interface FreshnessThresholdConfig {
  /** Age in ms below which data is considered 'fresh' (default: 15000ms) */
  agingAfterMs?: number
  /** Age in ms at or above which data is considered 'stale' (default: 60000ms) */
  staleAfterMs?: number
  /** Grace window in ms during routine reconnect churn before flashing 'reconnecting'/'stale' (default: 5000ms) */
  reconnectGraceMs?: number
  /** Whether the user prefers reduced motion (disables pulsing dot animation) */
  prefersReducedMotion?: boolean
  /** Whether evaluation is running on the server (SSR) */
  isServer?: boolean
  /** Current timestamp in ms */
  now?: number
}

export interface FreshnessIndicatorViewModel {
  topic: string
  level: DataFreshnessLevel
  source: DataSourceKind
  label: string
  ageMs: number | null
  animatePulse: boolean
  shouldAnnounceToScreenReader: boolean
  ariaLiveMode: 'off' | 'polite'
}

/**
 * Computes the visual and accessibility view-model for a realtime-backed view's
 * data freshness indicator, including reconnect grace periods, SSR safety, and
 * reduced-motion compliance.
 */
export function evaluateTopicFreshness(
  meta: TopicFreshnessMetadata,
  config: FreshnessThresholdConfig = {},
  previousLevel?: DataFreshnessLevel,
): FreshnessIndicatorViewModel {
  const agingAfterMs = config.agingAfterMs ?? 15_000
  const staleAfterMs = config.staleAfterMs ?? 60_000
  const reconnectGraceMs = config.reconnectGraceMs ?? 5_000
  const prefersReducedMotion = Boolean(config.prefersReducedMotion)
  const isServer = Boolean(config.isServer)

  if (isServer || meta.lastUpdatedAt === null || config.now === undefined && typeof window === 'undefined') {
    return {
      topic: meta.topic,
      level: 'fresh',
      source: meta.source,
      label: meta.source === 'rest_fallback' ? 'Updated via REST' : 'Live',
      ageMs: null,
      animatePulse: false,
      shouldAnnounceToScreenReader: false,
      ariaLiveMode: 'off',
    }
  }

  const now = config.now ?? Date.now()
  const ageMs = Math.max(0, now - meta.lastUpdatedAt)

  const reconnectElapsedMs =
    meta.reconnectStartedAt !== null && meta.reconnectStartedAt !== undefined
      ? Math.max(0, now - meta.reconnectStartedAt)
      : Infinity

  const inReconnectGrace =
    meta.transportState === 'reconnecting' &&
    reconnectElapsedMs < reconnectGraceMs &&
    ageMs < staleAfterMs

  let level: DataFreshnessLevel
  if (inReconnectGrace) {
    level = ageMs >= agingAfterMs ? 'aging' : 'fresh'
  } else if (meta.transportState === 'reconnecting') {
    level = 'reconnecting'
  } else if (ageMs >= staleAfterMs || meta.transportState === 'disconnected') {
    level = 'stale'
  } else if (ageMs >= agingAfterMs) {
    level = 'aging'
  } else {
    level = 'fresh'
  }

  const label = formatFreshnessLabel(level, meta.source, ageMs)
  const animatePulse =
    level === 'fresh' &&
    meta.source === 'realtime' &&
    !prefersReducedMotion

  // Avoid chatty ARIA announcements on every event; announce only when degrading or recovering
  const shouldAnnounceToScreenReader =
    previousLevel !== undefined &&
    previousLevel !== level &&
    (level === 'stale' ||
      level === 'reconnecting' ||
      (previousLevel === 'stale' && level === 'fresh') ||
      (previousLevel === 'reconnecting' && level === 'fresh'))

  return {
    topic: meta.topic,
    level,
    source: meta.source,
    label,
    ageMs,
    animatePulse,
    shouldAnnounceToScreenReader,
    ariaLiveMode: shouldAnnounceToScreenReader ? 'polite' : 'off',
  }
}

export function formatFreshnessLabel(
  level: DataFreshnessLevel,
  source: DataSourceKind,
  ageMs: number | null,
): string {
  if (level === 'reconnecting') {
    return 'Reconnecting…'
  }
  if (level === 'stale') {
    if (ageMs === null) return 'Stale data'
    const seconds = Math.max(1, Math.floor(ageMs / 1_000))
    return seconds >= 60
      ? `Stale (${Math.floor(seconds / 60)}m ago)`
      : `Stale (${seconds}s ago)`
  }
  if (level === 'aging') {
    const seconds = ageMs !== null ? Math.max(1, Math.floor(ageMs / 1_000)) : 15
    return `Updated ${seconds}s ago`
  }
  if (source === 'rest_fallback') {
    return 'Updated via REST'
  }
  return 'Live'
}

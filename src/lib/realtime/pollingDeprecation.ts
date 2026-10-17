export type PollingPathDisposition =
  | 'delete_on_ga'
  | 'retain_single_fetch_fallback'
  | 'handoff_adaptive_polling'

export type FreshnessExecutionMode =
  | 'realtime_primary'
  | 'single_fetch_fallback'
  | 'legacy_interval_polling'

export interface LegacyPollingInventoryItem {
  hookName: string
  topic: string
  legacyIntervalMs: number
  disposition: PollingPathDisposition
  requiredObservationWindowDays: number
  manualRefreshRetained: boolean
}

export const LEGACY_POLLING_INVENTORY: readonly LegacyPollingInventoryItem[] = [
  {
    hookName: 'useOracleStatus',
    topic: 'oracle_update',
    legacyIntervalMs: 15_000,
    disposition: 'delete_on_ga',
    requiredObservationWindowDays: 7,
    manualRefreshRetained: true,
  },
  {
    hookName: 'useRecentClaims',
    topic: 'claims:recent',
    legacyIntervalMs: 30_000,
    disposition: 'delete_on_ga',
    requiredObservationWindowDays: 7,
    manualRefreshRetained: true,
  },
  {
    hookName: 'useClaims',
    topic: 'claims:updates',
    legacyIntervalMs: 20_000,
    disposition: 'retain_single_fetch_fallback',
    requiredObservationWindowDays: 14,
    manualRefreshRetained: true,
  },
  {
    hookName: 'useNotifications',
    topic: 'notifications:user',
    legacyIntervalMs: 30_000,
    disposition: 'handoff_adaptive_polling',
    requiredObservationWindowDays: 14,
    manualRefreshRetained: true,
  },
] as const

export interface TopicRuntimeHealth {
  gaGateEnabled: boolean
  realtimeHealthy: boolean
  killSwitchActive?: boolean
  circuitBreakerOpen?: boolean
}

export interface FreshnessResolution {
  topic: string
  mode: FreshnessExecutionMode
  scheduleLegacyInterval: boolean
  legacyIntervalMs: number | null
  allowSeedFetch: boolean
  allowManualRefresh: boolean
}

/**
 * Resolves the active freshness execution mode for a topic, ensuring legacy
 * interval polling is never scheduled once the GA gate is enabled.
 */
export function resolveTopicFreshnessMode(
  topic: string,
  health: TopicRuntimeHealth,
  inventory: readonly LegacyPollingInventoryItem[] = LEGACY_POLLING_INVENTORY,
): FreshnessResolution {
  const normalized = topic.trim()
  const item = inventory.find((entry) => entry.topic === normalized)
  const circuitOpen = Boolean(health.circuitBreakerOpen)
  const killed = Boolean(health.killSwitchActive)

  if (health.gaGateEnabled) {
    if (!killed && health.realtimeHealthy) {
      return {
        topic: normalized,
        mode: 'realtime_primary',
        scheduleLegacyInterval: false,
        legacyIntervalMs: null,
        allowSeedFetch: !circuitOpen,
        allowManualRefresh: !circuitOpen,
      }
    }

    // GA enabled, but realtime is degraded or killed -> bounded single-fetch fallback (no legacy interval loop)
    return {
      topic: normalized,
      mode: 'single_fetch_fallback',
      scheduleLegacyInterval: false,
      legacyIntervalMs: null,
      allowSeedFetch: !circuitOpen,
      allowManualRefresh: !circuitOpen,
    }
  }

  // Pre-GA rollback state -> legacy interval polling allowed unless circuit breaker is open
  return {
    topic: normalized,
    mode: 'legacy_interval_polling',
    scheduleLegacyInterval: !circuitOpen,
    legacyIntervalMs: !circuitOpen ? (item?.legacyIntervalMs ?? 30_000) : null,
    allowSeedFetch: !circuitOpen,
    allowManualRefresh: !circuitOpen,
  }
}

export interface LegacyPollingDeprecationControllerOptions {
  fetchSnapshot: (topic: string, reason: 'seed' | 'fallback' | 'manual') => Promise<unknown>
  inventory?: readonly LegacyPollingInventoryItem[]
}

/**
 * Coordinates single-fetch REST seeding/fallback and user-initiated manual
 * refreshes after legacy interval polling is retired for GA topics.
 */
export class LegacyPollingDeprecationController {
  private readonly fetchSnapshot: (
    topic: string,
    reason: 'seed' | 'fallback' | 'manual',
  ) => Promise<unknown>
  private readonly inventory: readonly LegacyPollingInventoryItem[]
  private readonly activeIntervals = new Map<string, ReturnType<typeof setInterval>>()
  private readonly singleFetchCompleted = new Set<string>()

  constructor(options: LegacyPollingDeprecationControllerOptions) {
    this.fetchSnapshot = options.fetchSnapshot
    this.inventory = options.inventory ?? LEGACY_POLLING_INVENTORY
  }

  public reconcileTopic(
    topic: string,
    health: TopicRuntimeHealth,
  ): FreshnessResolution {
    const resolution = resolveTopicFreshnessMode(
      topic,
      health,
      this.inventory,
    )

    if (!resolution.scheduleLegacyInterval) {
      this.clearTopicInterval(resolution.topic)
    } else if (
      resolution.legacyIntervalMs &&
      !this.activeIntervals.has(resolution.topic)
    ) {
      const timer = setInterval(() => {
        void this.fetchSnapshot(resolution.topic, 'fallback')
      }, resolution.legacyIntervalMs)
      this.activeIntervals.set(resolution.topic, timer)
    }

    return resolution
  }

  /**
   * Executes a bounded single-fetch fallback (at most once per degradation episode)
   * when realtime is unavailable on a GA topic.
   */
  public async runBoundedFallbackFetch(
    topic: string,
    health: TopicRuntimeHealth,
  ): Promise<boolean> {
    const resolution = resolveTopicFreshnessMode(
      topic,
      health,
      this.inventory,
    )
    if (!resolution.allowSeedFetch) {
      return false
    }
    if (this.singleFetchCompleted.has(resolution.topic)) {
      return false
    }
    this.singleFetchCompleted.add(resolution.topic)
    await this.fetchSnapshot(resolution.topic, 'fallback')
    return true
  }

  public resetFallbackEpisode(topic: string): void {
    this.singleFetchCompleted.delete(topic.trim())
  }

  /**
   * Explicit user-initiated manual refresh respecting circuit breaker state.
   */
  public async manualRefresh(
    topic: string,
    health: TopicRuntimeHealth,
  ): Promise<boolean> {
    const resolution = resolveTopicFreshnessMode(
      topic,
      health,
      this.inventory,
    )
    if (!resolution.allowManualRefresh) {
      return false
    }
    await this.fetchSnapshot(resolution.topic, 'manual')
    return true
  }

  public getActiveIntervalTopics(): string[] {
    return Array.from(this.activeIntervals.keys())
  }

  public dispose(): void {
    for (const timer of this.activeIntervals.values()) {
      clearInterval(timer)
    }
    this.activeIntervals.clear()
    this.singleFetchCompleted.clear()
  }

  private clearTopicInterval(topic: string): void {
    const timer = this.activeIntervals.get(topic)
    if (timer) {
      clearInterval(timer)
      this.activeIntervals.delete(topic)
    }
  }
}

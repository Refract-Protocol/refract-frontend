export type RealtimeFidelityTier = 'full' | 'lite' | 'minimal'

export type FidelityTransportPreference = 'websocket' | 'sse' | 'polling'

export interface FidelityTierProfile {
  tier: RealtimeFidelityTier
  allowedTopicFamilies: string[]
  coalesceIntervalMs: number
  preferredTransport: FidelityTransportPreference
}

export interface ClientConstraintSignals {
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g' | string
  saveData?: boolean
  downlinkMbps?: number
  rttMs?: number
  batteryLevel?: number
  batteryCharging?: boolean
  hardwareConcurrency?: number
  deviceMemoryGb?: number
}

export interface FidelitySubscriptionDeltaInput {
  currentSubscriptions: string[]
  desiredTopics: string[]
  pinnedTopics?: string[]
  tier: RealtimeFidelityTier
  customProfiles?: Record<RealtimeFidelityTier, FidelityTierProfile>
}

export interface FidelitySubscriptionDelta {
  activeTopics: string[]
  toSubscribe: string[]
  toUnsubscribe: string[]
  retained: string[]
}

export const DEFAULT_FIDELITY_PROFILES: Record<
  RealtimeFidelityTier,
  FidelityTierProfile
> = {
  full: {
    tier: 'full',
    allowedTopicFamilies: ['claims', 'policies', 'pool', 'governance', 'telemetry'],
    coalesceIntervalMs: 50,
    preferredTransport: 'websocket',
  },
  lite: {
    tier: 'lite',
    allowedTopicFamilies: ['claims', 'policies', 'pool'],
    coalesceIntervalMs: 500,
    preferredTransport: 'websocket',
  },
  minimal: {
    tier: 'minimal',
    allowedTopicFamilies: ['claims'],
    coalesceIntervalMs: 2_000,
    preferredTransport: 'polling',
  },
}

const TIER_RANK: Record<RealtimeFidelityTier, number> = {
  full: 3,
  lite: 2,
  minimal: 1,
}

/**
 * Pure function that maps network, battery, and hardware signals to a fidelity tier.
 * Safe for SSR / browsers missing Network Information or Battery APIs (defaults to 'full').
 */
export function evaluateClientFidelityTier(
  signals: ClientConstraintSignals = {},
): RealtimeFidelityTier {
  const effectiveType = signals.effectiveType?.toLowerCase()

  // Severe constraints -> minimal
  if (
    signals.saveData === true ||
    effectiveType === 'slow-2g' ||
    effectiveType === '2g' ||
    (typeof signals.rttMs === 'number' && signals.rttMs >= 1_000) ||
    (typeof signals.downlinkMbps === 'number' && signals.downlinkMbps > 0 && signals.downlinkMbps < 0.4) ||
    (signals.batteryCharging === false &&
      typeof signals.batteryLevel === 'number' &&
      signals.batteryLevel <= 0.15)
  ) {
    return 'minimal'
  }

  // Moderate constraints -> lite
  if (
    effectiveType === '3g' ||
    (typeof signals.rttMs === 'number' && signals.rttMs >= 400) ||
    (typeof signals.downlinkMbps === 'number' && signals.downlinkMbps > 0 && signals.downlinkMbps < 1.5) ||
    (signals.batteryCharging === false &&
      typeof signals.batteryLevel === 'number' &&
      signals.batteryLevel <= 0.3) ||
    (typeof signals.hardwareConcurrency === 'number' &&
      signals.hardwareConcurrency > 0 &&
      signals.hardwareConcurrency <= 2) ||
    (typeof signals.deviceMemoryGb === 'number' &&
      signals.deviceMemoryGb > 0 &&
      signals.deviceMemoryGb <= 2)
  ) {
    return 'lite'
  }

  return 'full'
}

export function extractTopicFamily(topic: string): string {
  const trimmed = topic.trim()
  const colonIdx = trimmed.indexOf(':')
  return (colonIdx === -1 ? trimmed : trimmed.slice(0, colonIdx)).toLowerCase()
}

/**
 * Computes the exact subscribe/unsubscribe delta when transitioning between fidelity tiers.
 * Pinned critical topics (e.g. active claim settlement on the claims route) are NEVER dropped.
 */
export function computeFidelitySubscriptionDelta(
  input: FidelitySubscriptionDeltaInput,
): FidelitySubscriptionDelta {
  const profiles = input.customProfiles ?? DEFAULT_FIDELITY_PROFILES
  const profile = profiles[input.tier]
  const allowedFamilies = new Set(
    profile.allowedTopicFamilies.map((f) => f.toLowerCase()),
  )
  const pinnedSet = new Set(
    (input.pinnedTopics ?? []).map((t) => t.trim()).filter(Boolean),
  )
  const currentSet = new Set(
    input.currentSubscriptions.map((t) => t.trim()).filter(Boolean),
  )

  const desiredUnique = Array.from(
    new Set(
      [...input.desiredTopics, ...(input.pinnedTopics ?? [])]
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  )

  const activeTopics = desiredUnique.filter((topic) => {
    if (pinnedSet.has(topic)) {
      return true
    }
    const family = extractTopicFamily(topic)
    return allowedFamilies.has(family) || allowedFamilies.has('*')
  })

  const activeSet = new Set(activeTopics)
  const toSubscribe: string[] = []
  const retained: string[] = []
  const toUnsubscribe: string[] = []

  for (const topic of activeTopics) {
    if (currentSet.has(topic)) {
      retained.push(topic)
    } else {
      toSubscribe.push(topic)
    }
  }

  for (const current of currentSet) {
    if (!activeSet.has(current)) {
      toUnsubscribe.push(current)
    }
  }

  return {
    activeTopics,
    toSubscribe,
    toUnsubscribe,
    retained,
  }
}

export interface RealtimeFidelityControllerOptions {
  /** Cooldown window in ms before applying automatic tier upgrades/changes (default: 10000) */
  hysteresisCooldownMs?: number
  /** Immediate downgrade without waiting for hysteresis when severe constraint hits (default: true) */
  immediateSevereDowngrade?: boolean
  initialSignals?: ClientConstraintSignals
  manualOverride?: RealtimeFidelityTier | null
  profiles?: Record<RealtimeFidelityTier, FidelityTierProfile>
  now?: () => number
  onTierChange?: (
    nextTier: RealtimeFidelityTier,
    prevTier: RealtimeFidelityTier,
    profile: FidelityTierProfile,
  ) => void
}

/**
 * Manages active realtime fidelity tier with hysteresis cooldown, manual QA/user
 * override, and subscription delta reconciliation.
 */
export class RealtimeFidelityController {
  private readonly hysteresisCooldownMs: number
  private readonly immediateSevereDowngrade: boolean
  private readonly profiles: Record<RealtimeFidelityTier, FidelityTierProfile>
  private readonly now: () => number
  private readonly listeners = new Set<
    (
      tier: RealtimeFidelityTier,
      prevTier: RealtimeFidelityTier,
      profile: FidelityTierProfile,
    ) => void
  >()

  private signals: ClientConstraintSignals
  private manualOverride: RealtimeFidelityTier | null
  private autoTier: RealtimeFidelityTier
  private lastTransitionAt: number
  private disposed = false

  constructor(options: RealtimeFidelityControllerOptions = {}) {
    this.hysteresisCooldownMs = options.hysteresisCooldownMs ?? 10_000
    this.immediateSevereDowngrade = options.immediateSevereDowngrade ?? true
    this.profiles = options.profiles ?? DEFAULT_FIDELITY_PROFILES
    this.now = options.now ?? (() => Date.now())
    this.signals = { ...(options.initialSignals ?? {}) }
    this.manualOverride = options.manualOverride ?? null
    this.autoTier = evaluateClientFidelityTier(this.signals)
    this.lastTransitionAt = this.now()

    if (options.onTierChange) {
      this.listeners.add(options.onTierChange)
    }
  }

  public getEffectiveTier(): RealtimeFidelityTier {
    return this.manualOverride ?? this.autoTier
  }

  public getEffectiveProfile(): FidelityTierProfile {
    return this.profiles[this.getEffectiveTier()]
  }

  public setManualOverride(override: RealtimeFidelityTier | null): RealtimeFidelityTier {
    const prev = this.getEffectiveTier()
    this.manualOverride = override
    const next = this.getEffectiveTier()
    if (next !== prev) {
      this.lastTransitionAt = this.now()
      this.notify(next, prev)
    }
    return next
  }

  /**
   * Updates constraint signals (network/battery/hardware) and transitions tier
   * while respecting the hysteresis cooldown window to prevent flapping.
   */
  public updateSignals(partial: Partial<ClientConstraintSignals>): RealtimeFidelityTier {
    if (this.disposed) {
      return this.getEffectiveTier()
    }

    this.signals = { ...this.signals, ...partial }
    const candidateTier = evaluateClientFidelityTier(this.signals)
    if (candidateTier === this.autoTier) {
      return this.getEffectiveTier()
    }

    const currentTime = this.now()
    const elapsed = currentTime - this.lastTransitionAt
    const isDowngradeToMinimal =
      this.immediateSevereDowngrade &&
      candidateTier === 'minimal' &&
      TIER_RANK[candidateTier] < TIER_RANK[this.autoTier]

    if (!isDowngradeToMinimal && elapsed < this.hysteresisCooldownMs) {
      return this.getEffectiveTier()
    }

    const prevEffective = this.getEffectiveTier()
    this.autoTier = candidateTier
    this.lastTransitionAt = currentTime
    const nextEffective = this.getEffectiveTier()

    if (nextEffective !== prevEffective) {
      this.notify(nextEffective, prevEffective)
    }

    return nextEffective
  }

  public reconcileSubscriptions(params: {
    currentSubscriptions: string[]
    desiredTopics: string[]
    pinnedTopics?: string[]
  }): FidelitySubscriptionDelta {
    return computeFidelitySubscriptionDelta({
      currentSubscriptions: params.currentSubscriptions,
      desiredTopics: params.desiredTopics,
      pinnedTopics: params.pinnedTopics,
      tier: this.getEffectiveTier(),
      customProfiles: this.profiles,
    })
  }

  public onTierChange(
    listener: (
      tier: RealtimeFidelityTier,
      prevTier: RealtimeFidelityTier,
      profile: FidelityTierProfile,
    ) => void,
  ): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  private notify(
    nextTier: RealtimeFidelityTier,
    prevTier: RealtimeFidelityTier,
  ): void {
    const profile = this.profiles[nextTier]
    for (const listener of Array.from(this.listeners)) {
      listener(nextTier, prevTier, profile)
    }
  }
}

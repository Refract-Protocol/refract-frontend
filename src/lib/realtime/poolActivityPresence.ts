export type PoolActivityKind = 'deposit' | 'withdrawal' | 'coverage_written'

export interface SanitizedPoolActivityEntry {
  id: string
  kind: PoolActivityKind
  poolTier: string
  amountBucketLabel: string
  utilizationDeltaBps: number
  timestamp: number
}

export interface PoolPresenceViewState {
  status: 'active' | 'idle' | 'no_data'
  activeProvidersCount: number
  label: string
  lastHeartbeatAt: number | null
}

export interface PoolActivityPresenceOptions {
  /** Maximum entries retained in the newest-first activity ring buffer (default: 25) */
  maxActivityEntries?: number
  /** Client-side idle expiry window in ms for LP presence signals (default: 30000ms) */
  presenceIdleTimeoutMs?: number
  now?: () => number
}

const WALLET_KEY_PATTERN = /\b[GC][A-Z2-7]{10,55}\b|\b0x[a-fA-F0-9]{6,64}\b/gi

export function bucketizePoolAmount(amountUsd: unknown): string {
  if (typeof amountUsd !== 'number' || !Number.isFinite(amountUsd) || amountUsd <= 0) {
    return 'Pool activity'
  }
  if (amountUsd < 1_000) return '< $1K'
  if (amountUsd < 10_000) return '$1K – $10K'
  if (amountUsd < 100_000) return '$10K – $100K'
  return '$100K+'
}

/**
 * Enforces an allowlist privacy boundary on raw `pool:activity` payloads so
 * wallet addresses and exact LP position sizes never reach UI state.
 */
export function sanitizePoolActivityEvent(
  raw: Record<string, unknown>,
  fallbackTimestamp = Date.now(),
): SanitizedPoolActivityEntry | null {
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : ''
  const rawKind = raw.kind
  if (
    !rawId ||
    (rawKind !== 'deposit' &&
      rawKind !== 'withdrawal' &&
      rawKind !== 'coverage_written')
  ) {
    return null
  }

  const rawPoolTier =
    typeof raw.poolTier === 'string' && raw.poolTier.trim()
      ? raw.poolTier.trim()
      : 'senior-tranche'

  const scrubbedId = rawId.replace(WALLET_KEY_PATTERN, 'anon')
  const scrubbedTier = rawPoolTier.replace(WALLET_KEY_PATTERN, 'pool')

  const amountBucketLabel =
    typeof raw.amountBucketLabel === 'string' && raw.amountBucketLabel.trim()
      ? raw.amountBucketLabel.replace(WALLET_KEY_PATTERN, '[redacted]').trim()
      : bucketizePoolAmount(raw.amountUsd)

  const utilizationDeltaBps =
    typeof raw.utilizationDeltaBps === 'number' &&
    Number.isFinite(raw.utilizationDeltaBps)
      ? Math.round(raw.utilizationDeltaBps)
      : 0

  const timestamp =
    typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp)
      ? raw.timestamp
      : fallbackTimestamp

  return {
    id: scrubbedId,
    kind: rawKind,
    poolTier: scrubbedTier,
    amountBucketLabel,
    utilizationDeltaBps,
    timestamp,
  }
}

/**
 * Ephemeral LP presence and bounded newest-first pool activity ring buffer for `/provide`.
 */
export class PoolActivityAndPresenceStream {
  public static readonly ACTIVITY_TOPIC = 'pool:activity'
  public static readonly PRESENCE_TOPIC = 'pool:presence'

  private readonly maxEntries: number
  private readonly presenceIdleTimeoutMs: number
  private readonly now: () => number

  private readonly activityFeed: SanitizedPoolActivityEntry[] = []
  private readonly seenActivityIds = new Set<string>()
  private readonly activeSessionLastSeen = new Map<string, number>()
  private lastPresenceSignalAt: number | null = null
  private aggregateOverrideCount: number | null = null

  constructor(options: PoolActivityPresenceOptions = {}) {
    this.maxEntries = Math.max(1, options.maxActivityEntries ?? 25)
    this.presenceIdleTimeoutMs = Math.max(
      1_000,
      options.presenceIdleTimeoutMs ?? 30_000,
    )
    this.now = options.now ?? (() => Date.now())
  }

  public pushActivity(
    rawPayload: Record<string, unknown>,
  ): SanitizedPoolActivityEntry | null {
    const sanitized = sanitizePoolActivityEvent(rawPayload, this.now())
    if (!sanitized) return null

    if (this.seenActivityIds.has(sanitized.id)) {
      return null
    }
    this.seenActivityIds.add(sanitized.id)

    // Newest first
    this.activityFeed.unshift(sanitized)
    while (this.activityFeed.length > this.maxEntries) {
      const evicted = this.activityFeed.pop()
      if (evicted) {
        this.seenActivityIds.delete(evicted.id)
      }
    }

    return sanitized
  }

  /**
   * Records an ephemeral presence heartbeat (either pseudonymous session token
   * or aggregate active provider count).
   */
  public recordPresenceSignal(signal: {
    sessionHash?: string
    activeProvidersCount?: number
  }): PoolPresenceViewState {
    const currentTime = this.now()
    this.lastPresenceSignalAt = currentTime

    if (signal.sessionHash?.trim()) {
      const safeHash = signal.sessionHash
        .replace(WALLET_KEY_PATTERN, 'session')
        .trim()
      this.activeSessionLastSeen.set(safeHash, currentTime)
    }

    if (
      typeof signal.activeProvidersCount === 'number' &&
      Number.isFinite(signal.activeProvidersCount) &&
      signal.activeProvidersCount >= 0
    ) {
      this.aggregateOverrideCount = Math.floor(signal.activeProvidersCount)
    }

    return this.getPresenceState()
  }

  public getActivityFeed(): SanitizedPoolActivityEntry[] {
    return [...this.activityFeed]
  }

  public getPresenceState(): PoolPresenceViewState {
    if (this.lastPresenceSignalAt === null) {
      return {
        status: 'no_data',
        activeProvidersCount: 0,
        label: 'Live presence unavailable',
        lastHeartbeatAt: null,
      }
    }

    const currentTime = this.now()
    for (const [session, seenAt] of Array.from(
      this.activeSessionLastSeen.entries(),
    )) {
      if (currentTime - seenAt >= this.presenceIdleTimeoutMs) {
        this.activeSessionLastSeen.delete(session)
      }
    }

    const signalExpired =
      currentTime - this.lastPresenceSignalAt >= this.presenceIdleTimeoutMs
    if (signalExpired && this.activeSessionLastSeen.size === 0) {
      this.aggregateOverrideCount = null
      return {
        status: 'idle',
        activeProvidersCount: 0,
        label: 'No providers active right now',
        lastHeartbeatAt: this.lastPresenceSignalAt,
      }
    }

    const count = Math.max(
      this.activeSessionLastSeen.size,
      this.aggregateOverrideCount ?? 0,
    )

    return {
      status: count > 0 ? 'active' : 'idle',
      activeProvidersCount: count,
      label:
        count === 1
          ? '1 provider active now'
          : `${count} providers active now`,
      lastHeartbeatAt: this.lastPresenceSignalAt,
    }
  }
}

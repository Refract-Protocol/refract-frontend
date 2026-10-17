export interface ProtocolStatsSnapshot {
  totalValueLockedUsd: number
  activePoliciesCount: number
  cumulativePayoutsUsd: number
  reserveRatioBps: number
  updatedAt: number
}

export type ProtocolStatsDelta = Partial<ProtocolStatsSnapshot>

export interface ProtocolStatsViewState {
  stats: ProtocolStatsSnapshot
  source: 'seed' | 'realtime' | 'rest_fallback'
  isFallback: boolean
  animateTransitions: boolean
  tabularFontVariant: 'tabular-nums'
  commitCount: number
}

export interface ProtocolStatsStreamOptions {
  initialSeed?: ProtocolStatsSnapshot
  prefersReducedMotion?: boolean
  /** Animation-frame scheduler (defaults to requestAnimationFrame or 16ms timeout) */
  scheduleFrame?: (cb: () => void) => () => void
  now?: () => number
}

const DEFAULT_SEED: ProtocolStatsSnapshot = {
  totalValueLockedUsd: 0,
  activePoliciesCount: 0,
  cumulativePayoutsUsd: 0,
  reserveRatioBps: 10_000,
  updatedAt: 0,
}

export function formatTabularUsd(amountUsd: number): string {
  const safe = Number.isFinite(amountUsd) ? Math.max(0, amountUsd) : 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(safe))
}

/**
 * Manages live `protocol.stats` streaming with REST seeding, animation-frame
 * coalescing (at most 1 render per frame during bursts), and REST fallback.
 */
export class ProtocolStatsStreamStore {
  public static readonly TOPIC = 'protocol.stats'

  private state: ProtocolStatsViewState
  private pendingDelta: ProtocolStatsDelta | null = null
  private cancelFrame: (() => void) | null = null
  private readonly scheduleFrame: (cb: () => void) => () => void
  private readonly now: () => number
  private readonly listeners = new Set<(state: ProtocolStatsViewState) => void>()

  constructor(options: ProtocolStatsStreamOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.scheduleFrame =
      options.scheduleFrame ??
      ((cb) => {
        const id = setTimeout(cb, 16)
        return () => clearTimeout(id)
      })

    const seed = options.initialSeed ?? { ...DEFAULT_SEED }
    this.state = {
      stats: { ...seed },
      source: 'seed',
      isFallback: false,
      animateTransitions: !options.prefersReducedMotion,
      tabularFontVariant: 'tabular-nums',
      commitCount: 0,
    }
  }

  public getState(): ProtocolStatsViewState {
    return this.state
  }

  public subscribe(listener: (state: ProtocolStatsViewState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Seeds or updates the store from a REST snapshot without flickering existing non-zero fields.
   */
  public applyRestSnapshot(
    snapshot: ProtocolStatsDelta,
    isFallback = false,
  ): ProtocolStatsViewState {
    this.state = {
      ...this.state,
      stats: this.mergeValidFields(this.state.stats, snapshot),
      source: isFallback ? 'rest_fallback' : 'seed',
      isFallback,
      commitCount: this.state.commitCount + 1,
    }
    this.notify()
    return this.state
  }

  /**
   * Queues an incoming `protocol.stats` realtime delta and coalesces multiple updates
   * within the same animation frame into a single state commit.
   */
  public pushRealtimeDelta(delta: ProtocolStatsDelta): void {
    this.pendingDelta = {
      ...(this.pendingDelta ?? {}),
      ...delta,
    }

    if (this.cancelFrame !== null) {
      return
    }

    this.cancelFrame = this.scheduleFrame(() => {
      this.cancelFrame = null
      this.flushPendingFrame()
    })
  }

  public setReducedMotion(prefersReducedMotion: boolean): void {
    if (this.state.animateTransitions === !prefersReducedMotion) return
    this.state = {
      ...this.state,
      animateTransitions: !prefersReducedMotion,
    }
    this.notify()
  }

  public dispose(): void {
    if (this.cancelFrame) {
      this.cancelFrame()
      this.cancelFrame = null
    }
    this.pendingDelta = null
    this.listeners.clear()
  }

  private flushPendingFrame(): void {
    if (!this.pendingDelta) return
    const delta = this.pendingDelta
    this.pendingDelta = null

    this.state = {
      ...this.state,
      stats: this.mergeValidFields(this.state.stats, delta),
      source: 'realtime',
      isFallback: false,
      commitCount: this.state.commitCount + 1,
    }
    this.notify()
  }

  private mergeValidFields(
    current: ProtocolStatsSnapshot,
    delta: ProtocolStatsDelta,
  ): ProtocolStatsSnapshot {
    return {
      totalValueLockedUsd:
        typeof delta.totalValueLockedUsd === 'number' &&
        Number.isFinite(delta.totalValueLockedUsd) &&
        delta.totalValueLockedUsd >= 0
          ? delta.totalValueLockedUsd
          : current.totalValueLockedUsd,
      activePoliciesCount:
        typeof delta.activePoliciesCount === 'number' &&
        Number.isFinite(delta.activePoliciesCount) &&
        delta.activePoliciesCount >= 0
          ? delta.activePoliciesCount
          : current.activePoliciesCount,
      cumulativePayoutsUsd:
        typeof delta.cumulativePayoutsUsd === 'number' &&
        Number.isFinite(delta.cumulativePayoutsUsd) &&
        delta.cumulativePayoutsUsd >= 0
          ? delta.cumulativePayoutsUsd
          : current.cumulativePayoutsUsd,
      reserveRatioBps:
        typeof delta.reserveRatioBps === 'number' &&
        Number.isFinite(delta.reserveRatioBps) &&
        delta.reserveRatioBps >= 0
          ? delta.reserveRatioBps
          : current.reserveRatioBps,
      updatedAt:
        typeof delta.updatedAt === 'number' && Number.isFinite(delta.updatedAt)
          ? delta.updatedAt
          : this.now(),
    }
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      listener(this.state)
    }
  }
}

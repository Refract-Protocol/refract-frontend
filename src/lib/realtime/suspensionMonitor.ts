export type SuspensionWakeReason =
  | 'clock_drift'
  | 'bfcache_pageshow'
  | 'visibility_resume'
  | 'network_online'
  | 'manual'

export type ResyncStatus = 'idle' | 'resyncing' | 'synced' | 'error'

export interface SuspensionWakeEvent {
  reason: SuspensionWakeReason
  suspendedDurationMs: number
  detectedAt: number
  topicsResubscribed: string[]
}

export interface SuspensionMonitorOptions {
  /** Interval between wall-clock heartbeat checks (default: 2000ms) */
  tickIntervalMs?: number
  /** Elapsed wall-clock threshold indicating OS sleep or tab freeze (default: 15000ms) */
  wakeThresholdMs?: number
  /** Coalescing window to deduplicate simultaneous wake signals (default: 1500ms) */
  dedupeWindowMs?: number
  /** Clock provider for deterministic testing */
  now?: () => number
  /** Returns currently active realtime topics that require resubscription and resync */
  getActiveTopics: () => string[]
  /** Tears down potentially half-open socket and establishes a fresh transport session */
  forceReconnect: () => Promise<void> | void
  /** Sends a single atomic batch resubscribe frame for all active topics */
  resubscribeBatch: (topics: string[]) => Promise<void> | void
  /** Fetches fresh snapshots or cursor deltas for active topics */
  resyncSnapshots: (topics: string[]) => Promise<void> | void
  /** Optional listener for resync status transitions ('idle' | 'resyncing' | 'synced' | 'error') */
  onStatusChange?: (status: ResyncStatus, error?: Error) => void
  /** Optional listener invoked when a wake recovery completes */
  onWakeRecovered?: (event: SuspensionWakeEvent) => void
  /** Optional window/document event targets for browser or test injection */
  windowTarget?: {
    addEventListener: (type: string, listener: (ev: unknown) => void) => void
    removeEventListener: (type: string, listener: (ev: unknown) => void) => void
  } | null
  documentTarget?: {
    visibilityState?: string
    addEventListener: (type: string, listener: () => void) => void
    removeEventListener: (type: string, listener: () => void) => void
  } | null
}

/**
 * Monitors wall-clock heartbeat drift, bfcache restore (`pageshow`), and long
 * visibility suspensions to trigger a single deduplicated forced reconnect,
 * atomic batch resubscribe, and snapshot resync upon wake.
 */
export class SuspensionMonitor {
  private readonly tickIntervalMs: number
  private readonly wakeThresholdMs: number
  private readonly dedupeWindowMs: number
  private readonly now: () => number
  private readonly options: SuspensionMonitorOptions

  private status: ResyncStatus = 'idle'
  private timerId: ReturnType<typeof setInterval> | null = null
  private lastTickAt = 0
  private hiddenSince: number | null = null
  private lastRecoveryStartedAt = -Infinity
  private inFlightRecovery: Promise<SuspensionWakeEvent | null> | null = null
  private running = false
  private recoveryCount = 0

  private readonly handlePageShow = (rawEvent: unknown): void => {
    const persisted =
      typeof rawEvent === 'object' &&
      rawEvent !== null &&
      'persisted' in rawEvent &&
      Boolean((rawEvent as { persisted?: boolean }).persisted)

    if (persisted) {
      const current = this.now()
      const elapsed = Math.max(0, current - this.lastTickAt)
      this.lastTickAt = current
      void this.triggerRecovery('bfcache_pageshow', elapsed)
    }
  }

  private readonly handleVisibilityChange = (): void => {
    const doc = this.getDocumentTarget()
    if (!doc) return
    const current = this.now()

    if (doc.visibilityState === 'hidden') {
      this.hiddenSince = current
      return
    }

    if (doc.visibilityState === 'visible') {
      const baseline = this.hiddenSince ?? this.lastTickAt
      const suspendedMs = Math.max(0, current - baseline)
      this.hiddenSince = null
      this.lastTickAt = current
      if (suspendedMs >= this.wakeThresholdMs) {
        void this.triggerRecovery('visibility_resume', suspendedMs)
      }
    }
  }

  private readonly handleOnline = (): void => {
    const current = this.now()
    const elapsed = Math.max(0, current - this.lastTickAt)
    if (elapsed >= this.wakeThresholdMs) {
      this.lastTickAt = current
      void this.triggerRecovery('network_online', elapsed)
    }
  }

  constructor(options: SuspensionMonitorOptions) {
    this.options = options
    this.tickIntervalMs = options.tickIntervalMs ?? 2_000
    this.wakeThresholdMs = options.wakeThresholdMs ?? 15_000
    this.dedupeWindowMs = options.dedupeWindowMs ?? 1_500
    this.now = options.now ?? (() => Date.now())
  }

  public getStatus(): ResyncStatus {
    return this.status
  }

  public getRecoveryCount(): number {
    return this.recoveryCount
  }

  public isRunning(): boolean {
    return this.running
  }

  public start(): void {
    if (this.running) return
    this.running = true
    this.lastTickAt = this.now()

    const doc = this.getDocumentTarget()
    if (doc?.visibilityState === 'hidden') {
      this.hiddenSince = this.lastTickAt
    }

    this.timerId = setInterval(() => {
      this.checkHeartbeatDrift()
    }, this.tickIntervalMs)

    const win = this.getWindowTarget()
    if (win) {
      win.addEventListener('pageshow', this.handlePageShow)
      win.addEventListener('online', this.handleOnline)
    }
    if (doc) {
      doc.addEventListener('visibilitychange', this.handleVisibilityChange)
    }
  }

  public stop(): void {
    if (!this.running) return
    this.running = false

    if (this.timerId !== null) {
      clearInterval(this.timerId)
      this.timerId = null
    }

    const win = this.getWindowTarget()
    if (win) {
      win.removeEventListener('pageshow', this.handlePageShow)
      win.removeEventListener('online', this.handleOnline)
    }

    const doc = this.getDocumentTarget()
    if (doc) {
      doc.removeEventListener('visibilitychange', this.handleVisibilityChange)
    }
  }

  /**
   * Manually evaluates wall-clock drift or triggers recovery when elapsed >= wakeThresholdMs.
   */
  public checkHeartbeatDrift(): Promise<SuspensionWakeEvent | null> {
    const current = this.now()
    const elapsed = Math.max(0, current - this.lastTickAt)
    this.lastTickAt = current

    if (elapsed >= this.wakeThresholdMs) {
      return this.triggerRecovery('clock_drift', elapsed)
    }
    return Promise.resolve(null)
  }

  /**
   * Triggers a single deduplicated forced reconnect + batch resubscribe + snapshot resync.
   */
  public triggerRecovery(
    reason: SuspensionWakeReason = 'manual',
    suspendedDurationMs = 0,
  ): Promise<SuspensionWakeEvent | null> {
    if (this.inFlightRecovery) {
      return this.inFlightRecovery
    }

    const detectedAt = this.now()
    if (detectedAt - this.lastRecoveryStartedAt < this.dedupeWindowMs) {
      return Promise.resolve(null)
    }

    this.lastRecoveryStartedAt = detectedAt
    this.setStatus('resyncing')

    const uniqueTopics = Array.from(
      new Set(
        this.options
          .getActiveTopics()
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    )

    const run = async (): Promise<SuspensionWakeEvent | null> => {
      try {
        await this.options.forceReconnect()
        if (uniqueTopics.length > 0) {
          await this.options.resubscribeBatch(uniqueTopics)
          await this.options.resyncSnapshots(uniqueTopics)
        }

        const event: SuspensionWakeEvent = {
          reason,
          suspendedDurationMs,
          detectedAt,
          topicsResubscribed: uniqueTopics,
        }
        this.recoveryCount += 1
        this.setStatus('synced')
        this.options.onWakeRecovered?.(event)
        return event
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err))
        this.setStatus('error', errorObj)
        throw errorObj
      } finally {
        this.inFlightRecovery = null
      }
    }

    this.inFlightRecovery = run()
    return this.inFlightRecovery
  }

  private setStatus(nextStatus: ResyncStatus, error?: Error): void {
    this.status = nextStatus
    this.options.onStatusChange?.(nextStatus, error)
  }

  private getWindowTarget() {
    if (this.options.windowTarget !== undefined) {
      return this.options.windowTarget
    }
    if (typeof window !== 'undefined') {
      return window as unknown as NonNullable<SuspensionMonitorOptions['windowTarget']>
    }
    return null
  }

  private getDocumentTarget() {
    if (this.options.documentTarget !== undefined) {
      return this.options.documentTarget
    }
    if (typeof document !== 'undefined') {
      return document as unknown as NonNullable<SuspensionMonitorOptions['documentTarget']>
    }
    return null
  }
}

export type WarmupState =
  | 'cold'
  | 'scheduled'
  | 'warming'
  | 'warm_ready'
  | 'active_subscribed'
  | 'abandoned'
  | 'skipped'

export type WarmupSkipReason =
  | 'ssr_environment'
  | 'realtime_disabled'
  | 'user_opt_out'
  | 'save_data_enabled'
  | 'unsupported_route'

export interface WarmupEnvironmentSignals {
  isServer?: boolean
  realtimeEnabled?: boolean
  userOptOut?: boolean
  saveData?: boolean
  effectiveType?: string
}

export interface WarmupTimingMetrics {
  warmTriggeredAt: number | null
  warmConnectedAt: number | null
  firstSubscriberAttachedAt: number | null
  firstEventReceivedAt: number | null
  timeToFirstEventFromAttachMs: number | null
}

export interface RealtimeWarmupCoordinatorOptions {
  /** Idle window in ms before an unsubscribed warmed connection is torn down (default: 15000) */
  idleAbandonTimeoutMs?: number
  /** Routes eligible for hover/focus intent pre-warming */
  realtimeHeavyRoutes?: string[]
  /** Environment/capability signals */
  signals?: WarmupEnvironmentSignals
  /** Initiates the underlying transport handshake */
  connectTransport: () => Promise<void> | void
  /** Closes the underlying transport when abandoned or disposed */
  disconnectTransport: (reason: string) => void
  /** Optional idle scheduler override (defaults to requestIdleCallback or setTimeout(fn, 1)) */
  scheduleIdle?: (cb: () => void) => () => void
  /** Clock provider for deterministic testing */
  now?: () => number
}

const DEFAULT_HEAVY_ROUTES = ['/cover', '/provide', '/claims', '/dashboard']

/**
 * Coordinates non-blocking app-shell and route-intent pre-connection for the
 * realtime transport, with automatic idle teardown when no subscriber attaches.
 */
export class RealtimeWarmupCoordinator {
  private readonly idleAbandonTimeoutMs: number
  private readonly heavyRoutes: Set<string>
  private readonly options: RealtimeWarmupCoordinatorOptions
  private readonly now: () => number

  private state: WarmupState = 'cold'
  private lastSkipReason: WarmupSkipReason | null = null
  private signals: WarmupEnvironmentSignals
  private activeSubscribers = 0
  private cancelIdleTask: (() => void) | null = null
  private abandonTimerId: ReturnType<typeof setTimeout> | null = null

  private warmTriggeredAt: number | null = null
  private warmConnectedAt: number | null = null
  private firstSubscriberAttachedAt: number | null = null
  private firstEventReceivedAt: number | null = null

  constructor(options: RealtimeWarmupCoordinatorOptions) {
    this.options = options
    this.idleAbandonTimeoutMs = options.idleAbandonTimeoutMs ?? 15_000
    this.heavyRoutes = new Set(
      (options.realtimeHeavyRoutes ?? DEFAULT_HEAVY_ROUTES).map((r) =>
        this.normalizeRoute(r),
      ),
    )
    this.signals = {
      isServer: typeof window === 'undefined',
      realtimeEnabled: true,
      userOptOut: false,
      saveData: false,
      ...options.signals,
    }
    this.now = options.now ?? (() => Date.now())
  }

  public getState(): WarmupState {
    return this.state
  }

  public getLastSkipReason(): WarmupSkipReason | null {
    return this.lastSkipReason
  }

  public updateSignals(partial: Partial<WarmupEnvironmentSignals>): void {
    this.signals = { ...this.signals, ...partial }
  }

  /**
   * Schedules an idle pre-connect at the app-shell level without blocking first paint.
   */
  public warmAtAppShell(): boolean {
    const skip = this.evaluateGuard()
    if (skip) {
      this.state = 'skipped'
      this.lastSkipReason = skip
      return false
    }

    if (
      this.state === 'scheduled' ||
      this.state === 'warming' ||
      this.state === 'warm_ready' ||
      this.state === 'active_subscribed'
    ) {
      return true
    }

    this.lastSkipReason = null
    this.state = 'scheduled'
    this.warmTriggeredAt = this.now()

    const schedule = this.options.scheduleIdle ?? this.defaultScheduleIdle
    this.cancelIdleTask = schedule(() => {
      this.cancelIdleTask = null
      void this.executeWarmConnect()
    })

    return true
  }

  /**
   * Pre-warms the connection when the user hovers or focuses a navigation link
   * pointing to a realtime-heavy route (`/cover`, `/provide`, etc.).
   */
  public warmOnRouteIntent(routePath: string): boolean {
    const normalized = this.normalizeRoute(routePath)
    const isHeavy = Array.from(this.heavyRoutes).some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
    )
    if (!isHeavy) {
      if (this.state === 'cold') {
        this.lastSkipReason = 'unsupported_route'
      }
      return false
    }
    return this.warmAtAppShell()
  }

  /**
   * Attaches a subscribing hook/consumer to the warmed (or cold) connection.
   * Cancels the idle abandonment timer while at least one subscriber is active.
   */
  public attachSubscriber(): () => void {
    this.activeSubscribers += 1
    this.clearAbandonTimer()

    if (this.firstSubscriberAttachedAt === null) {
      this.firstSubscriberAttachedAt = this.now()
    }

    if (this.state === 'scheduled') {
      // Promote scheduled warm-up immediately
      if (this.cancelIdleTask) {
        this.cancelIdleTask()
        this.cancelIdleTask = null
      }
      void this.executeWarmConnect()
    } else if (
      this.state === 'cold' ||
      this.state === 'abandoned' ||
      this.state === 'skipped'
    ) {
      this.warmTriggeredAt = this.now()
      void this.executeWarmConnect()
    } else {
      this.state = 'active_subscribed'
    }

    let detached = false
    return () => {
      if (detached) return
      detached = true
      this.activeSubscribers = Math.max(0, this.activeSubscribers - 1)
      if (this.activeSubscribers === 0 && this.state === 'active_subscribed') {
        this.state = 'warm_ready'
        this.startAbandonTimer()
      }
    }
  }

  public recordFirstEvent(): void {
    if (this.firstEventReceivedAt === null) {
      this.firstEventReceivedAt = this.now()
    }
  }

  public getTimingMetrics(): WarmupTimingMetrics {
    const timeToFirstEventFromAttachMs =
      this.firstSubscriberAttachedAt !== null &&
      this.firstEventReceivedAt !== null
        ? Math.max(0, this.firstEventReceivedAt - this.firstSubscriberAttachedAt)
        : null

    return {
      warmTriggeredAt: this.warmTriggeredAt,
      warmConnectedAt: this.warmConnectedAt,
      firstSubscriberAttachedAt: this.firstSubscriberAttachedAt,
      firstEventReceivedAt: this.firstEventReceivedAt,
      timeToFirstEventFromAttachMs,
    }
  }

  public dispose(): void {
    if (this.cancelIdleTask) {
      this.cancelIdleTask()
      this.cancelIdleTask = null
    }
    this.clearAbandonTimer()
    if (
      this.state === 'warming' ||
      this.state === 'warm_ready' ||
      this.state === 'active_subscribed'
    ) {
      this.options.disconnectTransport('coordinator_disposed')
    }
    this.state = 'cold'
  }

  private async executeWarmConnect(): Promise<void> {
    if (this.state === 'warm_ready' || this.state === 'active_subscribed') {
      return
    }
    this.state = 'warming'
    await this.options.connectTransport()
    this.warmConnectedAt = this.now()

    if (this.activeSubscribers > 0) {
      this.state = 'active_subscribed'
    } else {
      this.state = 'warm_ready'
      this.startAbandonTimer()
    }
  }

  private startAbandonTimer(): void {
    this.clearAbandonTimer()
    this.abandonTimerId = setTimeout(() => {
      this.abandonTimerId = null
      if (this.activeSubscribers === 0) {
        this.state = 'abandoned'
        this.options.disconnectTransport('warmup_idle_timeout')
      }
    }, this.idleAbandonTimeoutMs)
  }

  private clearAbandonTimer(): void {
    if (this.abandonTimerId !== null) {
      clearTimeout(this.abandonTimerId)
      this.abandonTimerId = null
    }
  }

  private evaluateGuard(): WarmupSkipReason | null {
    if (this.signals.isServer) {
      return 'ssr_environment'
    }
    if (this.signals.realtimeEnabled === false) {
      return 'realtime_disabled'
    }
    if (this.signals.userOptOut === true) {
      return 'user_opt_out'
    }
    const eff = this.signals.effectiveType?.toLowerCase()
    if (
      this.signals.saveData === true ||
      eff === 'slow-2g' ||
      eff === '2g'
    ) {
      return 'save_data_enabled'
    }
    return null
  }

  private normalizeRoute(route: string): string {
    const clean = route.trim().split('?')[0].split('#')[0]
    if (!clean.startsWith('/')) {
      return `/${clean}`
    }
    return clean.length > 1 && clean.endsWith('/') ? clean.slice(0, -1) : clean
  }

  private readonly defaultScheduleIdle = (cb: () => void): (() => void) => {
    const timer = setTimeout(cb, 1)
    return () => clearTimeout(timer)
  }
}

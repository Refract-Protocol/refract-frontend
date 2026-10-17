/**
 * Remote kill switch and emergency disable controller for the realtime layer (#275).
 *
 * Polls a remote flag/config endpoint with a short timeout, supports automatic
 * local tripping when connection failure rates spike (without auto-un-tripping),
 * and guarantees that developer/QA overrides cannot defeat the kill switch in
 * production builds.
 */

export type KillSwitchTripSource = 'remote' | 'auto_failure_rate' | 'manual'

export interface KillSwitchTripEvent {
  source: KillSwitchTripSource
  reason: string
  trippedAt: number
}

export interface RemoteKillSwitchPayload {
  realtimeKillSwitch?: boolean
  realtimeEnabled?: boolean
  reason?: string
}

export interface RealtimeKillSwitchOptions {
  /** URL of the remote flags/kill-switch JSON (default: `/flags.json`). */
  endpoint?: string
  /** Custom fetch implementation for deterministic testing. */
  fetchFn?: typeof fetch
  /** Polling interval in ms (default: 30,000ms — matches one heartbeat interval). */
  pollIntervalMs?: number
  /** Per-request fetch timeout in ms so config polling never hangs (default: 3,000ms). */
  fetchTimeoutMs?: number
  /** Number of connection failures within `failureWindowMs` that triggers an auto-trip (default: 5). */
  autoTripFailureThreshold?: number
  /** Sliding window in ms for counting connection failures (default: 60,000ms). */
  failureWindowMs?: number
  /** Initial build-time default for whether the kill switch is tripped (default: false). */
  initialTripped?: boolean
  /** Whether the current build is production (default: `process.env.NODE_ENV === 'production'`). */
  isProduction?: boolean
  /** Clock provider for deterministic testing. */
  nowFn?: () => number
  /** Callback fired immediately when the kill switch trips so active sockets and subscriptions tear down. */
  onTripped?: (event: KillSwitchTripEvent) => void
  /** Callback fired when remote config explicitly clears a remote trip (does not clear auto-trips). */
  onRemoteCleared?: () => void
}

export class RealtimeKillSwitchController {
  private readonly endpoint: string
  private readonly fetchFn: typeof fetch
  private readonly pollIntervalMs: number
  private readonly fetchTimeoutMs: number
  private readonly autoTripFailureThreshold: number
  private readonly failureWindowMs: number
  private readonly isProduction: boolean
  private readonly nowFn: () => number
  private readonly onTripped?: (event: KillSwitchTripEvent) => void
  private readonly onRemoteCleared?: () => void

  private remoteTripped: boolean
  private localAutoTripped = false
  private manualTripped = false
  private lastTripEvent: KillSwitchTripEvent | null = null
  private failureTimestamps: number[] = []
  private pollTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: RealtimeKillSwitchOptions = {}) {
    this.endpoint = options.endpoint ?? '/flags.json'
    this.fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis)
    this.pollIntervalMs = Math.max(1_000, options.pollIntervalMs ?? 30_000)
    this.fetchTimeoutMs = Math.max(100, options.fetchTimeoutMs ?? 3_000)
    this.autoTripFailureThreshold = Math.max(
      1,
      options.autoTripFailureThreshold ?? 5
    )
    this.failureWindowMs = Math.max(1_000, options.failureWindowMs ?? 60_000)
    this.remoteTripped = options.initialTripped ?? false
    this.isProduction =
      options.isProduction ??
      (typeof process !== 'undefined' &&
        process.env?.NODE_ENV === 'production')
    this.nowFn = options.nowFn ?? (() => Date.now())
    this.onTripped = options.onTripped
    this.onRemoteCleared = options.onRemoteCleared

    if (this.remoteTripped) {
      this.lastTripEvent = {
        source: 'remote',
        reason: 'Initial build-time kill switch state',
        trippedAt: this.nowFn(),
      }
    }
  }

  /**
   * Synchronous predicate queried by the realtime client and hooks before
   * opening connections or reconnecting.
   *
   * Note: `devOverrideForceEnable` is only honored in non-production builds;
   * in production builds, a tripped kill switch ALWAYS wins.
   */
  isTripped(options: { devOverrideForceEnable?: boolean } = {}): boolean {
    const rawTripped =
      this.remoteTripped || this.localAutoTripped || this.manualTripped
    if (!rawTripped) {
      return false
    }
    if (options.devOverrideForceEnable && !this.isProduction) {
      return false
    }
    return true
  }

  getLastTripEvent(): KillSwitchTripEvent | null {
    return this.lastTripEvent
  }

  /**
   * Starts periodic background polling of the remote kill-switch endpoint.
   */
  startPolling(): void {
    if (this.pollTimer !== null) return
    void this.checkRemoteNow()
    this.pollTimer = setInterval(() => {
      void this.checkRemoteNow()
    }, this.pollIntervalMs)
  }

  stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  /**
   * Fetches the remote config once with a short timeout and cache-busting headers.
   * Never throws; retains the last known state on network failure.
   */
  async checkRemoteNow(): Promise<boolean> {
    if (!this.fetchFn) {
      return this.isTripped()
    }

    const abortController = new AbortController()
    const timeoutId = setTimeout(() => {
      abortController.abort()
    }, this.fetchTimeoutMs)

    try {
      const separator = this.endpoint.includes('?') ? '&' : '?'
      const url = `${this.endpoint}${separator}_ts=${this.nowFn()}`
      const response = await this.fetchFn(url, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
        signal: abortController.signal,
      })

      if (!response.ok) {
        return this.isTripped()
      }

      const data = (await response.json()) as RemoteKillSwitchPayload
      const shouldTrip =
        data.realtimeKillSwitch === true || data.realtimeEnabled === false

      if (shouldTrip && !this.remoteTripped) {
        this.remoteTripped = true
        this.emitTrip(
          'remote',
          data.reason ?? 'Remote kill switch activated via flags endpoint'
        )
      } else if (!shouldTrip && this.remoteTripped) {
        this.remoteTripped = false
        this.onRemoteCleared?.()
      }
    } catch {
      // Retain last known state on fetch timeout or network error
    } finally {
      clearTimeout(timeoutId)
    }

    return this.isTripped()
  }

  /**
   * Records a connection failure and trips the local circuit kill switch if
   * the failure rate within `failureWindowMs` reaches `autoTripFailureThreshold`.
   * Never auto-un-trips once tripped.
   */
  recordConnectionFailure(reason = 'Realtime connection failure threshold exceeded'): boolean {
    const now = this.nowFn()
    const cutoff = now - this.failureWindowMs
    this.failureTimestamps = this.failureTimestamps.filter((ts) => ts >= cutoff)
    this.failureTimestamps.push(now)

    if (
      !this.localAutoTripped &&
      this.failureTimestamps.length >= this.autoTripFailureThreshold
    ) {
      this.localAutoTripped = true
      this.emitTrip('auto_failure_rate', reason)
      return true
    }

    return this.isTripped()
  }

  /**
   * Trips the kill switch manually (e.g. emergency runtime command).
   */
  tripManually(reason = 'Manual operator kill switch'): void {
    if (this.manualTripped) return
    this.manualTripped = true
    this.emitTrip('manual', reason)
  }

  /**
   * Explicitly resets local auto-trip and manual trip states (never called automatically).
   */
  resetLocalTrips(): void {
    this.localAutoTripped = false
    this.manualTripped = false
    this.failureTimestamps = []
  }

  private emitTrip(source: KillSwitchTripSource, reason: string): void {
    const event: KillSwitchTripEvent = {
      source,
      reason,
      trippedAt: this.nowFn(),
    }
    this.lastTripEvent = event
    try {
      this.onTripped?.(event)
    } catch {
      // Never throw into caller
    }
  }
}

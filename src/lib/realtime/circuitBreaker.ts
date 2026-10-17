export type CircuitBreakerState = "closed" | "open" | "half_open";

export type FailureCategory =
  | "transport"
  | "timeout"
  | "server_error"
  | "rate_limit"
  | "auth"
  | "contract_mismatch";

export const DEFAULT_FAILURE_THRESHOLD = 5;
export const DEFAULT_PROBE_INTERVAL_MS = 30_000;

export interface CircuitBreakerSnapshot {
  state: CircuitBreakerState;
  enabled: boolean;
  consecutiveFailures: number;
  failureThreshold: number;
  probeIntervalMs: number;
  openedAt: number | null;
  nextProbeAt: number | null;
  totalTrips: number;
  restFallbackActive: boolean;
}

export type CircuitBreakerListener = (snapshot: CircuitBreakerSnapshot) => void;

export interface RealtimeCircuitBreakerOptions {
  /** Number of consecutive transient failures before tripping to `open` (default: 5). */
  failureThreshold?: number;
  /** Cooldown interval (ms) while `open` before transitioning to `half_open` probe (default: 30_000). */
  probeIntervalMs?: number;
  /** Feature-flag toggle; when disabled, the breaker stays `closed`. */
  enabled?: boolean;
  /** Optional callback triggered when the breaker transitions to `half_open`. */
  onHalfOpenProbe?: () => void;
  /** Injectable clock for deterministic unit tests. */
  now?: () => number;
}

const NON_TRIPPING_CATEGORIES = new Set<FailureCategory>(["auth", "contract_mismatch"]);

/**
 * Shared connection circuit breaker (`closed -> open -> half_open -> closed`)
 * that trips to REST-only fallback after repeated realtime transport failures
 * and periodically probes to restore streaming without endless reconnect churn.
 */
export class RealtimeCircuitBreaker {
  private state: CircuitBreakerState = "closed";
  private enabled: boolean;
  private consecutiveFailures = 0;
  private readonly failureThreshold: number;
  private readonly probeIntervalMs: number;
  private openedAt: number | null = null;
  private nextProbeAt: number | null = null;
  private totalTrips = 0;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onHalfOpenProbe?: () => void;
  private readonly now: () => number;
  private readonly listeners = new Set<CircuitBreakerListener>();

  constructor(options: RealtimeCircuitBreakerOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD);
    this.probeIntervalMs = Math.max(100, options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS);
    this.enabled = options.enabled ?? true;
    this.onHalfOpenProbe = options.onHalfOpenProbe;
    this.now = options.now ?? (() => Date.now());
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Returns `true` when hooks should operate in REST-only polling mode because
   * the circuit breaker is `open`.
   */
  isRestFallbackActive(): boolean {
    return this.enabled && this.state === "open";
  }

  /**
   * Returns `true` when the transport is allowed to attempt a live connection
   * (`closed` or `half_open` probe).
   */
  canAttemptRealtime(): boolean {
    if (!this.enabled) return true;
    if (this.state === "open") {
      const currentTime = this.now();
      if (this.nextProbeAt !== null && currentTime >= this.nextProbeAt) {
        this.transitionToHalfOpen();
        return true;
      }
      return false;
    }
    return true;
  }

  /**
   * Records a successful connection/frame delivery, closing the breaker and
   * resetting the consecutive failure counter.
   */
  recordSuccess(): void {
    this.clearProbeTimer();
    const changed = this.state !== "closed" || this.consecutiveFailures > 0;
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.nextProbeAt = null;
    if (changed) {
      this.emitChange();
    }
  }

  /**
   * Records a failure on the shared transport. Non-transient errors (`auth`,
   * `contract_mismatch`) do not count toward network failure trips.
   * Deduplicated at the connection level so a single socket drop trips once
   * regardless of subscriber count.
   */
  recordFailure(category: FailureCategory = "transport"): CircuitBreakerSnapshot {
    if (!this.enabled || NON_TRIPPING_CATEGORIES.has(category)) {
      return this.getSnapshot();
    }

    if (this.state === "half_open") {
      // Half-open probe failed -> re-open immediately for another cooldown window
      this.tripOpen();
      return this.getSnapshot();
    }

    if (this.state === "open") {
      return this.getSnapshot();
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.tripOpen();
    } else {
      this.emitChange();
    }

    return this.getSnapshot();
  }

  private tripOpen(): void {
    this.clearProbeTimer();
    const currentTime = this.now();
    this.state = "open";
    this.openedAt = currentTime;
    this.nextProbeAt = currentTime + this.probeIntervalMs;
    this.totalTrips += 1;

    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      this.transitionToHalfOpen();
    }, this.probeIntervalMs);

    this.emitChange();
  }

  private transitionToHalfOpen(): void {
    if (this.state !== "open") return;
    this.clearProbeTimer();
    this.state = "half_open";
    this.emitChange();
    this.onHalfOpenProbe?.();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.reset();
    } else {
      this.emitChange();
    }
  }

  reset(): void {
    this.clearProbeTimer();
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.nextProbeAt = null;
    this.emitChange();
  }

  getSnapshot(): CircuitBreakerSnapshot {
    return {
      state: this.state,
      enabled: this.enabled,
      consecutiveFailures: this.consecutiveFailures,
      failureThreshold: this.failureThreshold,
      probeIntervalMs: this.probeIntervalMs,
      openedAt: this.openedAt,
      nextProbeAt: this.nextProbeAt,
      totalTrips: this.totalTrips,
      restFallbackActive: this.isRestFallbackActive(),
    };
  }

  onChange(listener: CircuitBreakerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private clearProbeTimer(): void {
    if (this.probeTimer !== null) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  }

  private emitChange(): void {
    if (this.listeners.size === 0) return;
    const snap = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snap));
  }
}

export const realtimeCircuitBreaker = new RealtimeCircuitBreaker();

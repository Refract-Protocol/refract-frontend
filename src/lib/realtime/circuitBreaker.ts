/**
 * Circuit breaker for the realtime transport.
 *
 * Implements a three-state finite state machine:
 *
 *   CLOSED ──N consecutive failures──▶ OPEN
 *   OPEN ──probe interval elapses──▶ HALF_OPEN
 *   HALF_OPEN ──probe succeeds──▶ CLOSED
 *   HALF_OPEN ──probe fails──▶ OPEN
 *
 * While OPEN the transport is fully disabled — hooks fall back to REST and
 * no reconnect churn occurs. The breaker probes on a slow interval; a
 * successful probe closes the circuit and resumes realtime.
 *
 * The breaker is feature-flagged: when `enabled` is false it never trips and
 * always reports CLOSED, making it a no-op for environments that opt out.
 */

import { RealtimeError } from "./errors";

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  /** Consecutive failures required to trip from CLOSED to OPEN. */
  failureThreshold: number;
  /** Time between probes when OPEN, in milliseconds. */
  probeIntervalMs: number;
  /** Feature flag — when false the breaker never trips. */
  enabled: boolean;
}

export interface CircuitBreakerCallbacks {
  /** Called when the breaker transitions to OPEN (just tripped). */
  onTrip?: () => void;
  /** Called when the breaker transitions to HALF_OPEN (probe due). */
  onHalfOpen?: () => void;
  /** Called when the breaker transitions to CLOSED (recovered). */
  onClose?: () => void;
}

export const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 5;
export const DEFAULT_CIRCUIT_PROBE_INTERVAL_MS = 30_000;

/** Default feature flag: enabled unless explicitly disabled via env. */
export const DEFAULT_CIRCUIT_ENABLED =
  process.env.NEXT_PUBLIC_REALTIME_CIRCUIT_BREAKER !== "false";

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
  probeIntervalMs: DEFAULT_CIRCUIT_PROBE_INTERVAL_MS,
  enabled: DEFAULT_CIRCUIT_ENABLED,
};

/**
 * Determine whether an error should count toward the failure threshold.
 *
 * Only transport-level failures (`connection`, `retries_exhausted`) trip the
 * breaker. Per-frame errors (`parse`, `validation`) and per-topic errors
 * (`unsupported_version`) are expected and must not degrade the transport.
 */
export function shouldTrip(error: unknown): boolean {
  if (error instanceof RealtimeError) {
    return error.kind === "connection" || error.kind === "retries_exhausted";
  }
  // Unknown errors (raw socket close, factory throw) are connection failures.
  return true;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly config: CircuitBreakerConfig;
  private readonly callbacks: CircuitBreakerCallbacks;

  constructor(
    config: Partial<CircuitBreakerConfig> = {},
    callbacks: CircuitBreakerCallbacks = {},
  ) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
    this.callbacks = callbacks;
  }

  getState(): CircuitState {
    return this.state;
  }

  /** True when the breaker is fully OPEN and all transport should be blocked. */
  isOpen(): boolean {
    if (!this.config.enabled) return false;
    return this.state === "open";
  }

  /** True when the breaker is OPEN or HALF_OPEN — reconnects should be paused. */
  isBlockingReconnect(): boolean {
    if (!this.config.enabled) return false;
    return this.state === "open" || this.state === "half-open";
  }

  /** Record a successful connection. Resets the failure count and closes from HALF_OPEN. */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state === "half-open") {
      this.transition("closed");
    }
  }

  /**
   * Record a connection failure. If `error` is provided and is an expected
   * (non-transport) error, it is ignored.
   */
  recordFailure(error?: unknown): void {
    if (!this.config.enabled) return;
    if (error !== undefined && !shouldTrip(error)) return;

    if (this.state === "half-open") {
      // Probe failed — back to OPEN.
      this.transition("open");
      return;
    }
    if (this.state !== "closed") return;

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.transition("open");
    }
  }

  /** Force the breaker to a specific state (testing / manual override). */
  forceOpen(): void {
    this.transition("open");
  }

  forceClose(): void {
    this.consecutiveFailures = 0;
    this.transition("closed");
  }

  /** Reset to the initial CLOSED state and clear any pending probe. */
  reset(): void {
    this.clearProbe();
    this.consecutiveFailures = 0;
    this.state = "closed";
  }

  /** Clean up the probe timer (call on teardown). */
  dispose(): void {
    this.clearProbe();
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private transition(next: CircuitState): void {
    if (this.state === next) return;
    this.state = next;

    if (next === "open") {
      this.scheduleProbe();
      this.callbacks.onTrip?.();
    } else if (next === "half-open") {
      this.callbacks.onHalfOpen?.();
    } else if (next === "closed") {
      this.clearProbe();
      this.callbacks.onClose?.();
    }
  }

  private scheduleProbe(): void {
    this.clearProbe();
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      this.transition("half-open");
    }, this.config.probeIntervalMs);
  }

  private clearProbe(): void {
    if (this.probeTimer !== null) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
  }
}

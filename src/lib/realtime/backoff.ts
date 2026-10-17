export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 30_000;
export const DEFAULT_MIN_DELAY_MS = 100;
export const DEFAULT_STABILITY_THRESHOLD_MS = 10_000;

export type JitterStrategy = "equal" | "full" | "decorrelated" | "none";

export interface BackoffPolicyConfig {
  /** Initial backoff delay in milliseconds (default: 500). */
  baseDelayMs?: number;
  /** Maximum capped delay in milliseconds (default: 30_000). */
  maxDelayMs?: number;
  /** Strictly positive floor delay in milliseconds so jitter never yields <= 0 (default: 100). */
  minDelayMs?: number;
  /** Exponential growth factor per attempt (default: 2). */
  factor?: number;
  /** Jitter distribution applied to prevent synchronized reconnect storms (default: "equal"). */
  jitter?: JitterStrategy;
  /** Server-requested minimum wait time in milliseconds (`retryAfterMs` or close reason). */
  retryAfterMs?: number;
  /** Previous delay used when `jitter === "decorrelated"`. */
  previousDelayMs?: number;
  /** Injectable PRNG returning `[0, 1)` for deterministic tests. */
  random?: () => number;
}

/**
 * Pure helper computing the next reconnect delay with exponential growth, upper
 * cap, positive floor, optional server `retryAfterMs`, and configurable jitter.
 */
export function computeBackoff(attempt: number, config: BackoffPolicyConfig = {}): number {
  const baseDelayMs = Math.max(1, config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const minDelayMs = Math.max(1, Math.min(baseDelayMs, config.minDelayMs ?? DEFAULT_MIN_DELAY_MS));
  const factor = Math.max(1, config.factor ?? 2);
  const jitter = config.jitter ?? "equal";
  const random = config.random ?? Math.random;
  const clampedAttempt = Math.max(0, Math.min(30, Math.floor(attempt)));
  const u = Math.max(0, Math.min(1, random()));

  const expCap = Math.min(maxDelayMs, baseDelayMs * factor ** clampedAttempt);
  let delay: number;

  switch (jitter) {
    case "none":
      delay = expCap;
      break;
    case "full":
      delay = minDelayMs + u * Math.max(0, expCap - minDelayMs);
      break;
    case "decorrelated": {
      const prev = Math.max(baseDelayMs, config.previousDelayMs ?? baseDelayMs);
      const upper = Math.min(maxDelayMs, prev * 3);
      delay = baseDelayMs + u * Math.max(0, upper - baseDelayMs);
      break;
    }
    case "equal":
    default: {
      const half = expCap / 2;
      delay = half + u * half;
      break;
    }
  }

  if (typeof config.retryAfterMs === "number" && config.retryAfterMs > 0) {
    delay = Math.max(delay, config.retryAfterMs);
  }

  return Math.round(Math.min(maxDelayMs, Math.max(minDelayMs, delay)));
}

/**
 * Extracts a server-specified `retryAfterMs` hint from a WebSocket close reason
 * string (e.g. `"rate_limited:retry_after=5000"` or JSON `{"retryAfterMs":5000}`).
 */
export function parseCloseRetryAfter(closeReason?: string | null): number | undefined {
  if (!closeReason) return undefined;
  const trimmed = closeReason.trim();
  if (!trimmed) return undefined;

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { retryAfterMs?: unknown; retry_after_ms?: unknown };
      const val =
        typeof parsed.retryAfterMs === "number"
          ? parsed.retryAfterMs
          : typeof parsed.retry_after_ms === "number"
            ? parsed.retry_after_ms
            : undefined;
      if (val !== undefined && val > 0 && Number.isFinite(val)) {
        return Math.round(val);
      }
    } catch {
      // fall through to regex match
    }
  }

  const match = /retry[_-]?after(?:[_-]?ms)?\s*[=:]\s*(\d+)/i.exec(trimmed);
  if (match) {
    const ms = Number.parseInt(match[1], 10);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }

  return undefined;
}

export interface ReconnectBackoffControllerOptions extends BackoffPolicyConfig {
  /**
   * Minimum duration (ms) a connection must stay open before the attempt counter
   * is reset to 0 (default: 10_000). Prevents rapid open->close flapping from
   * resetting backoff to `baseDelayMs` and causing a reconnect storm.
   */
  stabilityThresholdMs?: number;
  now?: () => number;
}

/**
 * Stateful reconnect scheduler that manages attempt counters, stability windows,
 * and pending timers so rapid open/close cycles never cause a thundering herd.
 */
export class ReconnectBackoffController {
  private attempt = 0;
  private lastDelayMs = 0;
  private openedAt: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly options: ReconnectBackoffControllerOptions;
  private readonly stabilityThresholdMs: number;
  private readonly now: () => number;

  constructor(options: ReconnectBackoffControllerOptions = {}) {
    this.options = options;
    this.stabilityThresholdMs =
      options.stabilityThresholdMs ?? DEFAULT_STABILITY_THRESHOLD_MS;
    this.now = options.now ?? (() => Date.now());
  }

  getAttempt(): number {
    return this.attempt;
  }

  getLastDelayMs(): number {
    return this.lastDelayMs;
  }

  hasPendingReconnect(): boolean {
    return this.reconnectTimer !== null;
  }

  /**
   * Called when a socket transitions to `open`. Starts the stability timer;
   * `attempt` is only reset to 0 if the socket remains open for `stabilityThresholdMs`.
   */
  notifyOpen(): void {
    this.clearReconnectTimer();
    this.clearStabilityTimer();
    this.openedAt = this.now();

    this.stabilityTimer = setTimeout(() => {
      this.stabilityTimer = null;
      this.attempt = 0;
      this.lastDelayMs = 0;
    }, this.stabilityThresholdMs);
  }

  /**
   * Schedules a reconnect callback using capped exponential backoff with jitter.
   * If the connection closed before reaching `stabilityThresholdMs`, `attempt`
   * continues incrementing instead of resetting.
   */
  scheduleReconnect(
    onReconnect: () => void,
    closeHint?: { retryAfterMs?: number; closeReason?: string },
  ): number {
    this.clearStabilityTimer();
    if (this.openedAt !== null) {
      const openDuration = this.now() - this.openedAt;
      if (openDuration >= this.stabilityThresholdMs) {
        this.attempt = 0;
        this.lastDelayMs = 0;
      }
      this.openedAt = null;
    }

    if (this.reconnectTimer !== null) {
      return this.lastDelayMs;
    }

    const retryAfterMs =
      closeHint?.retryAfterMs ?? parseCloseRetryAfter(closeHint?.closeReason);

    const delay = computeBackoff(this.attempt, {
      ...this.options,
      retryAfterMs,
      previousDelayMs: this.lastDelayMs || undefined,
    });

    this.attempt += 1;
    this.lastDelayMs = delay;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      onReconnect();
    }, delay);

    return delay;
  }

  /**
   * Cancels all pending reconnect and stability timers on explicit `close()`.
   */
  cancel(): void {
    this.clearReconnectTimer();
    this.clearStabilityTimer();
    this.openedAt = null;
  }

  reset(): void {
    this.cancel();
    this.attempt = 0;
    this.lastDelayMs = 0;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearStabilityTimer(): void {
    if (this.stabilityTimer !== null) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
  }
}

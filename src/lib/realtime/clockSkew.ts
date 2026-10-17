export const DEFAULT_MAX_CLOCK_SAMPLES = 8;
export const DEFAULT_SKEW_WARNING_THRESHOLD_MS = 30_000;
export const DEFAULT_CLOCK_JUMP_RESET_MS = 60_000;
export const DEFAULT_MAX_RTT_SAMPLE_MS = 10_000;

export interface ClockRoundTripSample {
  /** Client epoch timestamp (ms) when `ping` or request was sent. */
  clientSendTs: number;
  /** Server epoch timestamp (ms) carried in `pong.serverTs` or response header. */
  serverTs: number;
  /** Client epoch timestamp (ms) when `pong` or response was received. */
  clientReceiveTs: number;
}

export interface ClockSkewDiagnostics {
  /**
   * Estimated `serverTime - clientTime` in milliseconds.
   * Positive when the server clock is ahead of the client clock;
   * negative when the client clock is ahead of the server clock.
   */
  offsetMs: number;
  /** Half of the minimum observed round-trip time (`minRtt / 2`), or `null` if uncalibrated. */
  uncertaintyMs: number | null;
  /** Number of valid RTT samples currently in the sliding window. */
  sampleCount: number;
  /** True when `Math.abs(offsetMs) >= skewWarningThresholdMs`. */
  skewWarningActive: boolean;
}

export interface ClockSkewEstimatorOptions {
  /** Sliding window size for RTT/offset samples (default: 8). */
  maxSamples?: number;
  /** Diagnostic threshold (ms) above which clock skew is flagged (default: 30_000). */
  skewWarningThresholdMs?: number;
  /** Sudden offset delta (ms) that indicates a local OS clock jump / sleep-wake reset (default: 60_000). */
  clockJumpResetMs?: number;
  /** Maximum acceptable RTT (ms) for a sample before discarding it as a network spike outlier (default: 10_000). */
  maxRttSampleMs?: number;
}

interface InternalSample {
  offsetMs: number;
  rttMs: number;
  recordedAt: number;
}

/**
 * Transport-independent server/client clock-offset estimator using NTP-style
 * midpoint round-trip samples (`serverTs - (clientSendTs + rtt / 2)`).
 * Filters high-RTT outliers by weighting low-RTT samples, detects mid-session
 * device clock jumps, and normalizes server event timestamps into client time.
 */
export class ClockSkewEstimator {
  private readonly maxSamples: number;
  private readonly skewWarningThresholdMs: number;
  private readonly clockJumpResetMs: number;
  private readonly maxRttSampleMs: number;
  private samples: InternalSample[] = [];
  private offsetMs = 0;
  private uncertaintyMs: number | null = null;

  constructor(options: ClockSkewEstimatorOptions = {}) {
    this.maxSamples = Math.max(1, options.maxSamples ?? DEFAULT_MAX_CLOCK_SAMPLES);
    this.skewWarningThresholdMs =
      options.skewWarningThresholdMs ?? DEFAULT_SKEW_WARNING_THRESHOLD_MS;
    this.clockJumpResetMs = options.clockJumpResetMs ?? DEFAULT_CLOCK_JUMP_RESET_MS;
    this.maxRttSampleMs = options.maxRttSampleMs ?? DEFAULT_MAX_RTT_SAMPLE_MS;
  }

  /**
   * Records a round-trip timing sample and updates the smoothed clock offset.
   */
  recordSample(sample: ClockRoundTripSample): ClockSkewDiagnostics {
    const rttMs = sample.clientReceiveTs - sample.clientSendTs;
    if (!Number.isFinite(rttMs) || rttMs < 0 || rttMs > this.maxRttSampleMs) {
      return this.getDiagnostics();
    }

    const midpointClientTs = sample.clientSendTs + rttMs / 2;
    const rawOffsetMs = Math.round(sample.serverTs - midpointClientTs);

    // Detect sudden device clock jumps (e.g. NTP step or laptop wake) and reset stale window
    if (
      this.samples.length >= 2 &&
      Math.abs(rawOffsetMs - this.offsetMs) >= this.clockJumpResetMs
    ) {
      this.samples = [];
    }

    this.samples.push({
      offsetMs: rawOffsetMs,
      rttMs,
      recordedAt: sample.clientReceiveTs,
    });

    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    this.recomputeEstimate();
    return this.getDiagnostics();
  }

  private recomputeEstimate(): void {
    if (this.samples.length === 0) {
      this.offsetMs = 0;
      this.uncertaintyMs = null;
      return;
    }

    // Select the lowest-RTT half of samples (NTP clock filter) and take their median offset
    const byRtt = [...this.samples].sort((a, b) => a.rttMs - b.rttMs);
    const bestCount = Math.max(1, Math.ceil(byRtt.length / 2));
    const bestSamples = byRtt.slice(0, bestCount);

    const sortedOffsets = bestSamples.map((s) => s.offsetMs).sort((a, b) => a - b);
    const mid = Math.floor(sortedOffsets.length / 2);
    const medianOffset =
      sortedOffsets.length % 2 === 1
        ? sortedOffsets[mid]
        : Math.round((sortedOffsets[mid - 1] + sortedOffsets[mid]) / 2);

    this.offsetMs = medianOffset;
    this.uncertaintyMs = Math.round(byRtt[0].rttMs / 2);
  }

  /**
   * Converts a server-emitted timestamp (`serverEventTs`) into normalized local
   * client epoch milliseconds (`serverEventTs - offsetMs`).
   */
  normalizeTimestamp(serverEventTs: number): number {
    return Math.round(serverEventTs - this.offsetMs);
  }

  /**
   * Computes non-negative elapsed age in milliseconds (`clientNow - normalizedTs`)
   * for relative-time labels ("4s ago") and staleness indicators.
   */
  getEventAgeMs(serverEventTs: number, clientNow = Date.now()): number {
    const normalized = this.normalizeTimestamp(serverEventTs);
    return Math.max(0, clientNow - normalized);
  }

  getDiagnostics(): ClockSkewDiagnostics {
    return {
      offsetMs: this.offsetMs,
      uncertaintyMs: this.uncertaintyMs,
      sampleCount: this.samples.length,
      skewWarningActive: Math.abs(this.offsetMs) >= this.skewWarningThresholdMs,
    };
  }

  reset(): void {
    this.samples = [];
    this.offsetMs = 0;
    this.uncertaintyMs = null;
  }
}

export const defaultClockSkewEstimator = new ClockSkewEstimator();

export function normalizeEventTimestamp(
  serverEventTs: number,
  estimator: ClockSkewEstimator = defaultClockSkewEstimator,
): number {
  return estimator.normalizeTimestamp(serverEventTs);
}

export function formatNormalizedRelativeAge(
  serverEventTs: number,
  clientNow = Date.now(),
  estimator: ClockSkewEstimator = defaultClockSkewEstimator,
): string {
  const ageMs = estimator.getEventAgeMs(serverEventTs, clientNow);
  const seconds = Math.floor(ageMs / 1_000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

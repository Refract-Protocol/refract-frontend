/**
 * Server/client clock-offset estimation (issue #247).
 *
 * Realtime events carry server timestamps. A device with a wrong clock would
 * render a just-arrived event as "in 3 hours" or flag fresh data as stale, so
 * every server timestamp goes through `normalizeServerTs` before it is
 * rendered or compared with `Date.now()`.
 *
 * Each heartbeat ping/pong gives one sample (NTP-style mid-point estimate):
 *
 *   t0       client wall clock when the ping was sent
 *   serverTs server wall clock when it answered
 *   t3       client wall clock when the pong arrived
 *
 *   rtt    = t3 - t0
 *   offset = serverTs - (t0 + t3) / 2      (positive => server is ahead)
 *
 * The true offset lies within ±rtt/2 of that estimate (latency may be
 * asymmetric), so low-RTT samples are the most trustworthy. The estimate is
 * the median offset of the lowest-RTT samples in a small sliding window, which
 * keeps a single slow or wild sample from moving it.
 *
 * The estimator does not know about any transport: WebSocket, SSE or
 * long-poll paths all feed it through `addSample`.
 */

/** Samples kept in the sliding window. */
export const CLOCK_SAMPLE_WINDOW = 8;

/** Samples slower than this are discarded outright (offset bound too loose). */
export const MAX_SAMPLE_RTT_MS = 10_000;

/**
 * If the wall clock and the monotonic clock drift apart by more than this
 * between two observations, the wall clock jumped (manual change, NTP step,
 * laptop sleep/resume). Every sample taken before the jump is invalidated.
 */
export const CLOCK_JUMP_THRESHOLD_MS = 2_000;

/**
 * Offsets larger than this are reported as a diagnostic (`skewed: true`).
 * Normalization still corrects for them; this only tells developers and
 * support that the user's device clock is noticeably wrong.
 */
export const SKEW_WARN_THRESHOLD_MS = 30_000;

/**
 * Subscribers are only notified when the offset moves by at least this much,
 * so UI bound to the offset does not re-render on sub-display-precision jitter.
 */
export const OFFSET_NOTIFY_THRESHOLD_MS = 250;

export interface ClockSyncSnapshot {
  /** Estimated server-minus-client offset in ms. Positive => server clock ahead. */
  readonly offsetMs: number;
  /** Half the best sample's RTT: the true offset is within ±this. `Infinity` when there are no samples. */
  readonly uncertaintyMs: number;
  /** Valid samples currently in the window. 0 => no estimate yet (offset treated as 0). */
  readonly sampleCount: number;
  /** True when |offset| exceeds `SKEW_WARN_THRESHOLD_MS`. Diagnostic only. */
  readonly skewed: boolean;
}

interface Sample {
  offset: number;
  rtt: number;
}

export interface ClockSources {
  /** Wall clock, ms since epoch. */
  wall: () => number;
  /** Monotonic clock, ms. Unaffected by wall-clock changes. */
  mono: () => number;
}

const defaultSources: ClockSources = {
  wall: () => Date.now(),
  mono: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
};

const EMPTY_SNAPSHOT: ClockSyncSnapshot = Object.freeze({
  offsetMs: 0,
  uncertaintyMs: Number.POSITIVE_INFINITY,
  sampleCount: 0,
  skewed: false,
});

export class ClockOffsetEstimator {
  private samples: Sample[] = [];
  private snapshot: ClockSyncSnapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<() => void>();
  /** Wall/mono pair from the last observation, used to detect clock jumps. */
  private anchor: { wall: number; mono: number } | null = null;

  constructor(private readonly sources: ClockSources = defaultSources) {}

  /**
   * Records one ping/pong round trip.
   * Returns false when the sample was rejected (negative or excessive RTT).
   */
  addSample(t0: number, serverTs: number, t3: number): boolean {
    this.checkForClockJump();
    const rtt = t3 - t0;
    if (!Number.isFinite(rtt) || !Number.isFinite(serverTs) || rtt < 0 || rtt > MAX_SAMPLE_RTT_MS)
      return false;

    this.samples.push({ offset: serverTs - (t0 + t3) / 2, rtt });
    if (this.samples.length > CLOCK_SAMPLE_WINDOW) this.samples.shift();
    this.recompute();
    return true;
  }

  /**
   * Detects a wall-clock jump since the last observation and, if one
   * happened, drops all samples (they were measured against the old clock).
   * Called on every sample; transports may also call it on wake/visibility
   * events.
   */
  checkForClockJump(): boolean {
    const wall = this.sources.wall();
    const mono = this.sources.mono();
    const prev = this.anchor;
    this.anchor = { wall, mono };
    if (!prev) return false;
    const drift = wall - prev.wall - (mono - prev.mono);
    if (Math.abs(drift) <= CLOCK_JUMP_THRESHOLD_MS) return false;
    this.reset();
    return true;
  }

  /**
   * Latest estimate. Subscribers are only notified on meaningful changes, so
   * UI should derive a display value (see `useServerRelativeTime`) rather
   * than render from this object directly.
   */
  getSnapshot = (): ClockSyncSnapshot => this.snapshot;

  /** Subscribe to meaningful estimate changes (see `OFFSET_NOTIFY_THRESHOLD_MS`). */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Converts a server timestamp (ms since epoch) into client wall-clock time. */
  normalize = (serverTs: number): number => serverTs - this.snapshot.offsetMs;

  /** Discards all samples (e.g. after a detected clock jump). */
  reset(): void {
    this.samples = [];
    this.publish(EMPTY_SNAPSHOT);
  }

  private recompute(): void {
    const minRtt = Math.min(...this.samples.map((s) => s.rtt));
    // Only trust samples close to the best observed latency: those have the
    // tightest offset bound. Slow samples are the classic outliers.
    const trusted = this.samples.filter((s) => s.rtt <= minRtt * 1.5 + 20);
    const offsets = trusted.map((s) => s.offset).sort((a, b) => a - b);
    const mid = offsets.length >> 1;
    const median = offsets.length % 2 ? offsets[mid]! : (offsets[mid - 1]! + offsets[mid]!) / 2;
    const offsetMs = Math.round(median);

    const next: ClockSyncSnapshot = Object.freeze({
      offsetMs,
      uncertaintyMs: Math.round(minRtt / 2),
      sampleCount: this.samples.length,
      skewed: Math.abs(offsetMs) > SKEW_WARN_THRESHOLD_MS,
    });

    const prev = this.snapshot;
    const meaningful =
      prev.sampleCount === 0 ||
      Math.abs(next.offsetMs - prev.offsetMs) >= OFFSET_NOTIFY_THRESHOLD_MS ||
      next.skewed !== prev.skewed;
    this.publish(next, meaningful);
  }

  /** Always stores the latest estimate; only wakes subscribers when it matters. */
  private publish(next: ClockSyncSnapshot, notify = true): void {
    if (next === this.snapshot) return;
    this.snapshot = next;
    if (notify) this.listeners.forEach((l) => l());
  }
}

/**
 * The app-wide estimator. Realtime transports write to it; everything else
 * should use the read-only helpers below rather than the instance itself.
 */
export const defaultClock = new ClockOffsetEstimator();

/** Read-only view of the current clock-sync estimate. */
export function getClockSync(): ClockSyncSnapshot {
  return defaultClock.getSnapshot();
}

/**
 * Converts a server timestamp (ms since epoch) into client wall-clock time.
 * Use this before rendering a server timestamp as a relative time or
 * comparing it with `Date.now()`.
 */
export function normalizeServerTs(
  serverTs: number,
  clock: ClockOffsetEstimator = defaultClock
): number {
  return clock.normalize(serverTs);
}

/** Age of a server-timestamped event in ms, measured on the client clock. Never negative. */
export function serverEventAgeMs(
  serverTs: number,
  now: number = Date.now(),
  clock: ClockOffsetEstimator = defaultClock
): number {
  return Math.max(0, now - clock.normalize(serverTs));
}

/** Freshness check for server-timestamped data, corrected for clock skew. */
export function isServerTsStale(
  serverTs: number,
  maxAgeMs: number,
  now: number = Date.now(),
  clock: ClockOffsetEstimator = defaultClock
): boolean {
  return serverEventAgeMs(serverTs, now, clock) > maxAgeMs;
}

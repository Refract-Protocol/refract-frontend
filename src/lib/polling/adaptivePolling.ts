import type { HealthSource, RealtimeHealth } from "@/lib/realtime/health";

/**
 * The one place REST fallback cadence is decided.
 *
 * Hooks no longer pick their own polling intervals. Each declares a
 * criticality tier and the realtime topic that would otherwise push its data;
 * the interval follows that topic's realtime health:
 *
 * - healthy:     realtime is delivering, so REST only polls occasionally as a
 *                safety net (or not at all for background data).
 * - degraded /
 *   unavailable: realtime can't be trusted, so REST polls at roughly the
 *                cadence the app used before realtime existed.
 *
 * Health changes are smoothed with hysteresis (see `StableHealth`): getting
 * worse tightens polling immediately, getting better only widens it after
 * realtime has stayed better for `MIN_HEALTHY_DWELL_MS`. A flapping
 * connection therefore keeps the tight cadence instead of thrashing.
 */

export type PollTier = "critical" | "standard" | "background";

/** Interval in ms per tier and health; `false` means no interval polling. */
export const POLL_INTERVALS: Record<PollTier, Record<RealtimeHealth, number | false>> = {
  /** Data users act on: oracle readings, their own claims. */
  critical: { healthy: 5 * 60_000, degraded: 60_000, unavailable: 60_000 },
  /** Public activity feeds: recent payouts. */
  standard: { healthy: 10 * 60_000, degraded: 2 * 60_000, unavailable: 2 * 60_000 },
  /** Slow-moving or derived data: notification time windows. */
  background: { healthy: 15 * 60_000, degraded: 5 * 60_000, unavailable: 5 * 60_000 },
};

/** How long realtime must stay healthier before polling widens. */
export const MIN_HEALTHY_DWELL_MS = 30_000;

export function pollIntervalFor(tier: PollTier, health: RealtimeHealth): number | false {
  return POLL_INTERVALS[tier][health];
}

const RANK: Record<RealtimeHealth, number> = { healthy: 0, degraded: 1, unavailable: 2 };

/**
 * Hysteresis over a raw health signal for one topic. Worse health is adopted
 * immediately; better health only after it has held for `minDwellMs`.
 */
export class StableHealth {
  private current: RealtimeHealth;
  private improveTimer: ReturnType<typeof setTimeout> | null = null;
  private improveTarget: RealtimeHealth | null = null;
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;

  constructor(
    private readonly source: HealthSource,
    private readonly topic: string,
    private readonly minDwellMs: number = MIN_HEALTHY_DWELL_MS
  ) {
    this.current = source.get(topic);
    this.unsubscribe = source.subscribe(() => this.onRaw(source.get(topic)));
  }

  get(): RealtimeHealth {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.unsubscribe();
    this.cancelImprove();
    this.listeners.clear();
  }

  private onRaw(raw: RealtimeHealth): void {
    if (RANK[raw] >= RANK[this.current]) {
      // Same or worse: adopt now and forget any pending improvement.
      this.cancelImprove();
      this.set(raw);
      return;
    }
    // Better: wait out the dwell time. A further improvement restarts the wait
    // toward the better target; a relapse (handled above) cancels it.
    if (this.improveTarget === raw) return;
    this.cancelImprove();
    this.improveTarget = raw;
    this.improveTimer = setTimeout(() => {
      this.improveTimer = null;
      this.improveTarget = null;
      if (RANK[this.source.get(this.topic)] <= RANK[raw]) this.set(raw);
    }, this.minDwellMs);
  }

  private cancelImprove(): void {
    if (this.improveTimer) clearTimeout(this.improveTimer);
    this.improveTimer = null;
    this.improveTarget = null;
  }

  private set(next: RealtimeHealth): void {
    if (next === this.current) return;
    this.current = next;
    this.listeners.forEach((listener) => listener());
  }
}

export interface AdaptivePollerOptions {
  /** One REST poll. Must honour the abort signal so recovery can cancel it. */
  poll: (signal: AbortSignal) => Promise<unknown>;
  tier: PollTier;
  topic: string;
  health: HealthSource;
  minDwellMs?: number;
  /** Visibility source; defaults to `document`. Polling pauses while hidden. */
  isHidden?: () => boolean;
}

/**
 * Framework-free poller driven by the policy above. TanStack hooks use
 * `useAdaptivePolling` instead, but both share `pollIntervalFor` +
 * `StableHealth`, so the cadence policy lives in one place.
 */
export function createAdaptivePoller(opts: AdaptivePollerOptions) {
  const isHidden =
    opts.isHidden ??
    (() => typeof document !== "undefined" && document.visibilityState === "hidden");
  const stable = new StableHealth(opts.health, opts.topic, opts.minDwellMs);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: AbortController | null = null;
  let running = false;
  let lastPollAt = 0;

  const interval = () => pollIntervalFor(opts.tier, stable.get());

  function clear() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clear();
    const ms = interval();
    if (!running || ms === false) return;
    const wait = Math.max(0, lastPollAt + ms - Date.now());
    timer = setTimeout(tick, wait);
  }

  async function tick() {
    timer = null;
    if (!running) return;
    if (isHidden()) {
      schedule();
      return;
    }
    inflight?.abort();
    const controller = new AbortController();
    inflight = controller;
    lastPollAt = Date.now();
    try {
      await opts.poll(controller.signal);
    } catch {
      // Poll failures are the hook's concern; keep the cadence going.
    } finally {
      if (inflight === controller) inflight = null;
      if (running && !timer) schedule();
    }
  }

  const unsubscribe = stable.subscribe(() => {
    // Recovery: realtime is delivering again, so cancel the in-flight poll
    // rather than letting it finish its cycle.
    if (stable.get() === "healthy") {
      inflight?.abort();
      inflight = null;
    }
    schedule();
  });

  return {
    start() {
      if (running) return;
      running = true;
      lastPollAt = Date.now();
      schedule();
    },
    stop() {
      running = false;
      clear();
      inflight?.abort();
      inflight = null;
      unsubscribe();
      stable.dispose();
    },
    /** Current effective interval (after hysteresis). */
    interval,
  };
}

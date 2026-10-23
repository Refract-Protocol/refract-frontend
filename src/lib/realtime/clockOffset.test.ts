import { describe, expect, it, vi } from "vitest";
import {
  ClockOffsetEstimator,
  CLOCK_SAMPLE_WINDOW,
  isServerTsStale,
  serverEventAgeMs,
  SKEW_WARN_THRESHOLD_MS,
  type ClockSources,
} from "./clockOffset";
import { formatServerRelativeTime } from "@/hooks/useServerRelativeTime";

/** Controllable wall + monotonic clocks. */
function fakeSources(start = 1_700_000_000_000) {
  let wall = start;
  let mono = 0;
  const sources: ClockSources = { wall: () => wall, mono: () => mono };
  return {
    sources,
    advance(ms: number) {
      wall += ms;
      mono += ms;
    },
    jumpWall(ms: number) {
      wall += ms;
    },
    get wall() {
      return wall;
    },
  };
}

/**
 * Simulates one ping/pong where the server clock is `trueOffset` ahead and
 * the request/response legs take `up`/`down` ms.
 */
function roundTrip(
  est: ClockOffsetEstimator,
  clk: ReturnType<typeof fakeSources>,
  trueOffset: number,
  up: number,
  down: number
) {
  const t0 = clk.wall;
  clk.advance(up);
  const serverTs = clk.wall + trueOffset;
  clk.advance(down);
  return est.addSample(t0, serverTs, clk.wall);
}

describe("ClockOffsetEstimator", () => {
  it("starts with no estimate", () => {
    const est = new ClockOffsetEstimator(fakeSources().sources);
    expect(est.getSnapshot()).toMatchObject({ offsetMs: 0, sampleCount: 0, skewed: false });
    expect(est.getSnapshot().uncertaintyMs).toBe(Infinity);
  });

  it("recovers the exact offset with symmetric latency", () => {
    const clk = fakeSources();
    const est = new ClockOffsetEstimator(clk.sources);
    roundTrip(est, clk, 5_000, 40, 40);
    expect(est.getSnapshot()).toMatchObject({ offsetMs: 5_000, uncertaintyMs: 40, sampleCount: 1 });
  });

  it("stays within ±rtt/2 under asymmetric latency", () => {
    const clk = fakeSources();
    const est = new ClockOffsetEstimator(clk.sources);
    roundTrip(est, clk, -3_000, 10, 90); // 100 ms rtt, heavily asymmetric
    const { offsetMs, uncertaintyMs } = est.getSnapshot();
    expect(Math.abs(offsetMs - -3_000)).toBeLessThanOrEqual(uncertaintyMs);
    expect(uncertaintyMs).toBe(50);
  });

  it("ignores a single slow outlier sample", () => {
    const clk = fakeSources();
    const est = new ClockOffsetEstimator(clk.sources);
    for (let i = 0; i < 4; i++) roundTrip(est, clk, 2_000, 20, 20);
    // 4 s RTT, almost all of it on one leg: a naive estimate is off by ~2 s.
    roundTrip(est, clk, 2_000, 4_000, 20);
    expect(est.getSnapshot().offsetMs).toBe(2_000);
    expect(est.getSnapshot().sampleCount).toBe(5);
  });

  it("ignores a single wild low-latency sample (median)", () => {
    const clk = fakeSources();
    const est = new ClockOffsetEstimator(clk.sources);
    roundTrip(est, clk, 1_000, 20, 20);
    roundTrip(est, clk, 1_000, 20, 20);
    roundTrip(est, clk, 60_000, 20, 20);
    expect(est.getSnapshot().offsetMs).toBe(1_000);
  });

  it("rejects negative and excessive round trips", () => {
    const clk = fakeSources();
    const est = new ClockOffsetEstimator(clk.sources);
    expect(est.addSample(1_000, 5_000, 900)).toBe(false);
    expect(est.addSample(0, 5_000, 60_000)).toBe(false);
    expect(est.getSnapshot().sampleCount).toBe(0);
  });

  it("keeps a bounded window", () => {
    const clk = fakeSources();
    const est = new ClockOffsetEstimator(clk.sources);
    for (let i = 0; i < CLOCK_SAMPLE_WINDOW + 5; i++) roundTrip(est, clk, 0, 10, 10);
    expect(est.getSnapshot().sampleCount).toBe(CLOCK_SAMPLE_WINDOW);
  });

  it("invalidates samples when the wall clock jumps (sleep/resume, manual change)", () => {
    const clk = fakeSources();
    const est = new ClockOffsetEstimator(clk.sources);
    roundTrip(est, clk, 10_000, 20, 20);
    roundTrip(est, clk, 10_000, 20, 20);
    clk.jumpWall(10_000); // the user fixed their clock; server offset is now ~0
    roundTrip(est, clk, 0, 20, 20);
    expect(est.getSnapshot()).toMatchObject({ offsetMs: 0, sampleCount: 1 });
  });

  it("only notifies subscribers on meaningful changes", () => {
    const clk = fakeSources();
    const est = new ClockOffsetEstimator(clk.sources);
    const listener = vi.fn();
    est.subscribe(listener);

    roundTrip(est, clk, 1_000, 20, 20);
    expect(listener).toHaveBeenCalledTimes(1);

    // Jitter well under the notify threshold: the estimate refines silently.
    roundTrip(est, clk, 1_030, 20, 20);
    roundTrip(est, clk, 990, 20, 20);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(est.getSnapshot().sampleCount).toBe(3);

    // A real change (> threshold) notifies once the median moves.
    for (let i = 0; i < 5; i++) roundTrip(est, clk, 5_000, 20, 20);
    expect(listener.mock.calls.length).toBeGreaterThan(1);
    expect(est.getSnapshot().offsetMs).toBe(5_000);
  });

  it("flags large offsets as a diagnostic", () => {
    const clk = fakeSources();
    const est = new ClockOffsetEstimator(clk.sources);
    roundTrip(est, clk, SKEW_WARN_THRESHOLD_MS + 5_000, 20, 20);
    expect(est.getSnapshot().skewed).toBe(true);
  });
});

describe("normalized time helpers", () => {
  it("renders correct relative times on a device whose clock is 3 hours behind", () => {
    const realNow = Date.UTC(2026, 9, 21, 12, 0, 0);
    const deviceNow = realNow - 3 * 60 * 60 * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(deviceNow);
    try {
      const clk = fakeSources(deviceNow);
      const est = new ClockOffsetEstimator(clk.sources);
      roundTrip(est, clk, 3 * 60 * 60 * 1000, 25, 25);
      vi.setSystemTime(clk.wall);

      // An event the server stamped 4 s ago (on the server's clock).
      const serverTs = clk.wall + 3 * 60 * 60 * 1000 - 4_000;
      expect(serverEventAgeMs(serverTs, clk.wall, est)).toBe(4_000);
      expect(formatServerRelativeTime(serverTs, est)).toBe("just now");
      expect(formatServerRelativeTime(serverTs - 5 * 60_000, est)).toBe("5 minutes ago");

      // Without correction a 5-minute-old event looks like it's from the
      // future (clamped to "just now"), and a fresh one looks 3 hours ahead.
      const uncorrected = new ClockOffsetEstimator(clk.sources);
      expect(formatServerRelativeTime(serverTs - 5 * 60_000, uncorrected)).toBe("just now");
      expect(serverEventAgeMs(serverTs, clk.wall, uncorrected)).toBe(0);
      expect(isServerTsStale(serverTs, 30_000, clk.wall, est)).toBe(false);
      expect(isServerTsStale(serverTs - 60_000, 30_000, clk.wall, est)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not flag fresh data as stale when the device clock is ahead", () => {
    const clk = fakeSources();
    const est = new ClockOffsetEstimator(clk.sources);
    roundTrip(est, clk, -10 * 60_000, 20, 20); // device 10 minutes fast
    const serverTs = clk.wall - 10 * 60_000 - 1_000;
    expect(isServerTsStale(serverTs, 30_000, clk.wall, est)).toBe(false);
    expect(isServerTsStale(serverTs, 30_000, clk.wall, new ClockOffsetEstimator(clk.sources))).toBe(
      true
    );
  });
});

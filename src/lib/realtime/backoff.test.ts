import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeBackoff,
  parseCloseRetryAfter,
  ReconnectBackoffController,
} from "./backoff";

describe("Exponential Backoff & Reconnect Storm Mitigation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("grows exponentially, respects maxDelayMs cap, and stays strictly positive across jitter bounds", () => {
    const delaysNoJitter = [0, 1, 2, 3, 4, 10].map((attempt) =>
      computeBackoff(attempt, {
        baseDelayMs: 500,
        maxDelayMs: 5_000,
        jitter: "none",
      }),
    );
    expect(delaysNoJitter).toEqual([500, 1_000, 2_000, 4_000, 5_000, 5_000]);

    for (const r of [0, 0.25, 0.5, 0.999]) {
      const equalJitter = computeBackoff(2, {
        baseDelayMs: 500,
        maxDelayMs: 30_000,
        minDelayMs: 100,
        jitter: "equal",
        random: () => r,
      });
      // expCap = 2000, equal jitter range is [1000, 2000]
      expect(equalJitter).toBeGreaterThanOrEqual(1_000);
      expect(equalJitter).toBeLessThanOrEqual(2_000);

      const fullJitter = computeBackoff(0, {
        baseDelayMs: 500,
        minDelayMs: 100,
        jitter: "full",
        random: () => r,
      });
      expect(fullJitter).toBeGreaterThanOrEqual(100);
      expect(fullJitter).toBeLessThanOrEqual(500);
    }
  });

  it("honours server retryAfterMs and parses close reason hints", () => {
    expect(parseCloseRetryAfter("rate_limited:retry_after=7500")).toBe(7_500);
    expect(parseCloseRetryAfter('{"retryAfterMs":12000}')).toBe(12_000);
    expect(parseCloseRetryAfter("normal_closure")).toBeUndefined();

    const delay = computeBackoff(0, {
      baseDelayMs: 500,
      maxDelayMs: 30_000,
      jitter: "none",
      retryAfterMs: 8_000,
    });
    expect(delay).toBe(8_000);
  });

  it("prevents reconnect storms during rapid open/close flapping by resetting only after stabilityThresholdMs", () => {
    let clock = 0;
    const controller = new ReconnectBackoffController({
      baseDelayMs: 500,
      maxDelayMs: 10_000,
      stabilityThresholdMs: 10_000,
      jitter: "none",
      now: () => clock,
    });

    const fired: number[] = [];

    // Cycle 1: fails after only 1,000ms open (< 10,000ms stability threshold)
    controller.notifyOpen();
    clock += 1_000;
    vi.advanceTimersByTime(1_000);
    const d1 = controller.scheduleReconnect(() => fired.push(1));
    expect(d1).toBe(500);
    expect(controller.getAttempt()).toBe(1);

    clock += d1;
    vi.advanceTimersByTime(d1);
    expect(fired).toEqual([1]);

    // Cycle 2: opens again, but drops after 2,000ms -> attempt must NOT reset!
    controller.notifyOpen();
    clock += 2_000;
    vi.advanceTimersByTime(2_000);
    const d2 = controller.scheduleReconnect(() => fired.push(2));
    expect(d2).toBe(1_000);
    expect(controller.getAttempt()).toBe(2);

    clock += d2;
    vi.advanceTimersByTime(d2);
    expect(fired).toEqual([1, 2]);

    // Cycle 3: stays open for 12,000ms (>= 10,000ms threshold) -> attempt resets to 0!
    controller.notifyOpen();
    clock += 12_000;
    vi.advanceTimersByTime(12_000);
    expect(controller.getAttempt()).toBe(0);

    const d3 = controller.scheduleReconnect(() => fired.push(3));
    expect(d3).toBe(500);

    // Explicit cancel clears pending timers
    controller.cancel();
    expect(controller.hasPendingReconnect()).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(fired).toEqual([1, 2]);
  });
});

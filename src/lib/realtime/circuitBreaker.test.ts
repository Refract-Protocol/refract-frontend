import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeCircuitBreaker } from "./circuitBreaker";

describe("RealtimeCircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("trips open after N consecutive failures, transitions to half_open on probe timer, and closes on success", () => {
    let clock = 1_000;
    const probes: number[] = [];
    const breaker = new RealtimeCircuitBreaker({
      failureThreshold: 3,
      probeIntervalMs: 10_000,
      now: () => clock,
      onHalfOpenProbe: () => probes.push(clock),
    });

    expect(breaker.getState()).toBe("closed");
    expect(breaker.canAttemptRealtime()).toBe(true);
    expect(breaker.isRestFallbackActive()).toBe(false);

    breaker.recordFailure("transport");
    breaker.recordFailure("timeout");
    expect(breaker.getState()).toBe("closed");
    expect(breaker.getSnapshot().consecutiveFailures).toBe(2);

    // 3rd failure trips circuit to open
    breaker.recordFailure("server_error");
    expect(breaker.getState()).toBe("open");
    expect(breaker.isRestFallbackActive()).toBe(true);
    expect(breaker.canAttemptRealtime()).toBe(false);
    expect(breaker.getSnapshot().totalTrips).toBe(1);

    // After probeIntervalMs, transitions to half_open and triggers probe callback
    clock = 11_000;
    vi.advanceTimersByTime(10_000);
    expect(breaker.getState()).toBe("half_open");
    expect(breaker.canAttemptRealtime()).toBe(true);
    expect(probes).toEqual([11_000]);

    // Successful probe closes the breaker
    breaker.recordSuccess();
    expect(breaker.getState()).toBe("closed");
    expect(breaker.isRestFallbackActive()).toBe(false);
    expect(breaker.getSnapshot().consecutiveFailures).toBe(0);
  });

  it("re-opens immediately if a half-open probe fails", () => {
    let clock = 0;
    const breaker = new RealtimeCircuitBreaker({
      failureThreshold: 2,
      probeIntervalMs: 5_000,
      now: () => clock,
    });

    breaker.recordFailure("transport");
    breaker.recordFailure("transport");
    expect(breaker.getState()).toBe("open");
    expect(breaker.getSnapshot().totalTrips).toBe(1);

    clock = 5_000;
    vi.advanceTimersByTime(5_000);
    expect(breaker.getState()).toBe("half_open");

    // Failed probe immediately trips back to open
    breaker.recordFailure("transport");
    expect(breaker.getState()).toBe("open");
    expect(breaker.getSnapshot().totalTrips).toBe(2);
    expect(breaker.isRestFallbackActive()).toBe(true);
  });

  it("ignores non-network auth and contract_mismatch errors so they do not trip the breaker", () => {
    const breaker = new RealtimeCircuitBreaker({
      failureThreshold: 2,
    });

    breaker.recordFailure("auth");
    breaker.recordFailure("contract_mismatch");
    breaker.recordFailure("auth");

    expect(breaker.getState()).toBe("closed");
    expect(breaker.getSnapshot().consecutiveFailures).toBe(0);
  });
});

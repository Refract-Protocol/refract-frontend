import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CircuitBreaker,
  shouldTrip,
  type CircuitState,
} from "./circuitBreaker";
import {
  RealtimeConnectionError,
  RealtimeParseError,
  RealtimeValidationError,
  UnsupportedVersionError,
} from "./errors";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function makeBreaker(opts: { threshold?: number; probeMs?: number; enabled?: boolean } = {}) {
  return new CircuitBreaker({
    failureThreshold: opts.threshold ?? 3,
    probeIntervalMs: opts.probeMs ?? 1000,
    enabled: opts.enabled ?? true,
  });
}

describe("CircuitBreaker state machine", () => {
  it("starts in CLOSED state", () => {
    const cb = makeBreaker();
    expect(cb.getState()).toBe("closed");
    expect(cb.isOpen()).toBe(false);
    expect(cb.isBlockingReconnect()).toBe(false);
  });

  it("trips OPEN after the configured threshold of consecutive failures", () => {
    const cb = makeBreaker({ threshold: 3 });
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.isOpen()).toBe(true);
    expect(cb.isBlockingReconnect()).toBe(true);
  });

  it("does not trip before the threshold", () => {
    const cb = makeBreaker({ threshold: 5 });
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.getState()).toBe("closed");
  });

  it("recordSuccess resets the failure count", () => {
    const cb = makeBreaker({ threshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
  });

  it("transitions to HALF_OPEN after the probe interval", () => {
    const cb = makeBreaker({ threshold: 2, probeMs: 500 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    vi.advanceTimersByTime(499);
    expect(cb.getState()).toBe("open");

    vi.advanceTimersByTime(1);
    expect(cb.getState()).toBe("half-open");
    expect(cb.isBlockingReconnect()).toBe(true);
    expect(cb.isOpen()).toBe(false);
  });

  it("closes on success from HALF_OPEN", () => {
    const cb = makeBreaker({ threshold: 2, probeMs: 500 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(500);
    expect(cb.getState()).toBe("half-open");

    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
    expect(cb.isBlockingReconnect()).toBe(false);
  });

  it("reopens on failure from HALF_OPEN", () => {
    const cb = makeBreaker({ threshold: 2, probeMs: 500 });
    cb.recordFailure();
    cb.recordFailure();
    vi.advanceTimersByTime(500);
    expect(cb.getState()).toBe("half-open");

    cb.recordFailure();
    expect(cb.getState()).toBe("open");
  });

  it("schedules a new probe after a failed half-open probe", () => {
    const cb = makeBreaker({ threshold: 1, probeMs: 500 });
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    vi.advanceTimersByTime(500);
    expect(cb.getState()).toBe("half-open");

    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    vi.advanceTimersByTime(500);
    expect(cb.getState()).toBe("half-open");
  });

  it("does not count parse errors as failures", () => {
    const cb = makeBreaker({ threshold: 2 });
    cb.recordFailure(new RealtimeParseError("bad json"));
    cb.recordFailure(new RealtimeParseError("bad json"));
    expect(cb.getState()).toBe("closed");
    expect(cb.isOpen()).toBe(false);
  });

  it("does not count validation errors as failures", () => {
    const cb = makeBreaker({ threshold: 2 });
    cb.recordFailure(new RealtimeValidationError("bad shape"));
    cb.recordFailure(new RealtimeValidationError("bad shape"));
    expect(cb.getState()).toBe("closed");
  });

  it("does not count unsupported_version errors as failures", () => {
    const cb = makeBreaker({ threshold: 2 });
    cb.recordFailure(new UnsupportedVersionError("oracle_update", 99));
    cb.recordFailure(new UnsupportedVersionError("oracle_update", 99));
    expect(cb.getState()).toBe("closed");
  });

  it("counts connection errors as failures", () => {
    const cb = makeBreaker({ threshold: 2 });
    cb.recordFailure(new RealtimeConnectionError("socket died"));
    cb.recordFailure(new RealtimeConnectionError("socket died"));
    expect(cb.getState()).toBe("open");
  });

  it("counts retries_exhausted errors as failures", () => {
    const cb = makeBreaker({ threshold: 1 });
    cb.recordFailure(new RealtimeConnectionError("done", "retries_exhausted"));
    expect(cb.getState()).toBe("open");
  });

  it("disabled breaker never trips", () => {
    const cb = makeBreaker({ threshold: 1, enabled: false });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    expect(cb.isOpen()).toBe(false);
    expect(cb.isBlockingReconnect()).toBe(false);
  });

  it("invokes onTrip when transitioning to OPEN", () => {
    const onTrip = vi.fn();
    const cb = new CircuitBreaker({ failureThreshold: 1, probeIntervalMs: 1000, enabled: true }, { onTrip });
    cb.recordFailure();
    expect(onTrip).toHaveBeenCalledTimes(1);
  });

  it("invokes onHalfOpen when transitioning to HALF_OPEN", () => {
    const onHalfOpen = vi.fn();
    const cb = new CircuitBreaker({ failureThreshold: 1, probeIntervalMs: 500, enabled: true }, { onHalfOpen });
    cb.recordFailure();
    vi.advanceTimersByTime(500);
    expect(onHalfOpen).toHaveBeenCalledTimes(1);
  });

  it("invokes onClose when transitioning from HALF_OPEN to CLOSED", () => {
    const onClose = vi.fn();
    const cb = new CircuitBreaker({ failureThreshold: 1, probeIntervalMs: 500, enabled: true }, { onClose });
    cb.recordFailure();
    vi.advanceTimersByTime(500);
    cb.recordSuccess();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("forceOpen and forceClose change state immediately", () => {
    const cb = makeBreaker({ threshold: 5 });
    cb.forceOpen();
    expect(cb.getState()).toBe("open");
    cb.forceClose();
    expect(cb.getState()).toBe("closed");
  });

  it("reset returns to CLOSED and clears the probe timer", () => {
    const cb = makeBreaker({ threshold: 1, probeMs: 500 });
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    cb.reset();
    expect(cb.getState()).toBe("closed");
    // No probe should fire.
    vi.advanceTimersByTime(1000);
    expect(cb.getState()).toBe("closed");
  });

  it("dispose clears the probe timer", () => {
    const cb = makeBreaker({ threshold: 1, probeMs: 500 });
    cb.recordFailure();
    cb.dispose();
    vi.advanceTimersByTime(1000);
    expect(cb.getState()).toBe("open");
  });
});

describe("shouldTrip", () => {
  it("returns true for connection errors", () => {
    expect(shouldTrip(new RealtimeConnectionError("fail"))).toBe(true);
    expect(shouldTrip(new RealtimeConnectionError("done", "retries_exhausted"))).toBe(true);
  });

  it("returns false for parse, validation, and unsupported_version errors", () => {
    expect(shouldTrip(new RealtimeParseError("bad"))).toBe(false);
    expect(shouldTrip(new RealtimeValidationError("bad"))).toBe(false);
    expect(shouldTrip(new UnsupportedVersionError("t", 1))).toBe(false);
  });

  it("returns true for unknown errors (raw socket failures)", () => {
    expect(shouldTrip(new Error("socket closed"))).toBe(true);
    expect(shouldTrip("string error")).toBe(true);
    expect(shouldTrip(undefined)).toBe(true);
  });
});

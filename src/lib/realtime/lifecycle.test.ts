import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_HIDDEN_MS, WAKE_DRIFT_MS, WAKE_TICK_MS, WakeDetector } from "./lifecycle";

describe("WakeDetector", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("ignores normal ticks", () => {
    const onWake = vi.fn();
    const d = new WakeDetector(onWake);
    vi.setSystemTime(Date.now() + WAKE_TICK_MS);
    d.tick();
    expect(onWake).not.toHaveBeenCalled();
  });

  it("fires once on a large clock jump (sleep)", () => {
    const onWake = vi.fn();
    const d = new WakeDetector(onWake);
    vi.setSystemTime(Date.now() + WAKE_TICK_MS + WAKE_DRIFT_MS + 1);
    d.tick();
    d.tick();
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(onWake).toHaveBeenCalledWith("clock-drift");
  });

  it("fires on bfcache restore only when persisted", () => {
    const onWake = vi.fn();
    const d = new WakeDetector(onWake);
    d.pageShow(false);
    expect(onWake).not.toHaveBeenCalled();
    d.pageShow(true);
    expect(onWake).toHaveBeenCalledWith("bfcache");
  });

  it("ignores short backgrounds, fires after long hidden", () => {
    const onWake = vi.fn();
    const d = new WakeDetector(onWake);
    d.visibility(false);
    vi.setSystemTime(Date.now() + 5_000);
    d.visibility(true);
    expect(onWake).not.toHaveBeenCalled();
    d.visibility(false);
    vi.setSystemTime(Date.now() + LONG_HIDDEN_MS);
    d.visibility(true);
    expect(onWake).toHaveBeenCalledWith("long-hidden");
  });

  it("collapses simultaneous signals into one wake", () => {
    const onWake = vi.fn();
    const d = new WakeDetector(onWake);
    d.visibility(false);
    vi.setSystemTime(Date.now() + LONG_HIDDEN_MS + WAKE_DRIFT_MS + WAKE_TICK_MS);
    d.pageShow(true);
    d.visibility(true);
    d.tick();
    expect(onWake).toHaveBeenCalledTimes(1);
  });
});

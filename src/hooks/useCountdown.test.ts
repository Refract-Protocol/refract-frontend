import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCountdown } from "./useCountdown";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("useCountdown", () => {
  it("ticks at the given cadence", () => {
    const target = Date.now() + 10 * 60_000;
    const { result } = renderHook(() => useCountdown(target, 60_000));
    expect(result.current.remainingMs).toBe(10 * 60_000);
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.remainingMs).toBe(9 * 60_000);
    act(() => vi.advanceTimersByTime(59_000));
    expect(result.current.remainingMs).toBe(9 * 60_000);
  });

  it("reports expired immediately for a past target and never ticks", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const target = Date.now() - 1000;
    const { result } = renderHook(() => useCountdown(target));
    expect(result.current).toEqual({ remainingMs: 0, expired: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it("becomes expired when the target is reached and stops ticking", () => {
    const target = Date.now() + 90_000;
    const { result } = renderHook(() => useCountdown(target, 60_000));
    act(() => vi.advanceTimersByTime(120_000));
    expect(result.current.expired).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the interval on unmount", () => {
    const target = Date.now() + 600_000;
    const { unmount } = renderHook(() => useCountdown(target));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restarts when the target changes", () => {
    const { result, rerender } = renderHook(({ t }) => useCountdown(t), { initialProps: { t: Date.now() + 60_000 } });
    rerender({ t: Date.now() + 600_000 });
    expect(result.current.remainingMs).toBe(600_000);
    expect(vi.getTimerCount()).toBe(1);
  });
});

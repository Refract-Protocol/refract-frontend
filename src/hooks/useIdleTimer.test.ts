import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIdleTimer } from "./useIdleTimer";

const TIMEOUT = 15 * 60_000;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useIdleTimer", () => {
  it("becomes idle after the timeout with no activity", () => {
    const { result } = renderHook(() => useIdleTimer({ timeoutMs: TIMEOUT }));
    expect(result.current.idle).toBe(false);
    act(() => vi.advanceTimersByTime(TIMEOUT));
    expect(result.current.idle).toBe(true);
  });

  it("resets the timer on user activity", () => {
    const { result } = renderHook(() => useIdleTimer({ timeoutMs: TIMEOUT }));
    act(() => vi.advanceTimersByTime(TIMEOUT - 1000));
    act(() => {
      window.dispatchEvent(new Event("keydown"));
    });
    act(() => vi.advanceTimersByTime(TIMEOUT - 1000));
    expect(result.current.idle).toBe(false);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.idle).toBe(true);
  });

  it("stays idle on later activity until reset() is called", () => {
    const { result } = renderHook(() => useIdleTimer({ timeoutMs: TIMEOUT }));
    act(() => vi.advanceTimersByTime(TIMEOUT));
    act(() => {
      window.dispatchEvent(new Event("click"));
    });
    expect(result.current.idle).toBe(true);
    act(() => result.current.reset());
    expect(result.current.idle).toBe(false);
    act(() => vi.advanceTimersByTime(TIMEOUT));
    expect(result.current.idle).toBe(true);
  });

  it("catches a missed timeout on the next activity event", () => {
    const { result } = renderHook(() => useIdleTimer({ timeoutMs: TIMEOUT }));
    // Simulate a suspended tab: clock jumps without the timer callback running.
    act(() => {
      vi.setSystemTime(Date.now() + TIMEOUT + 1000);
      window.dispatchEvent(new Event("mousemove"));
    });
    expect(result.current.idle).toBe(true);
  });

  it("is never idle while disabled and cleans up listeners on unmount", () => {
    const { result, unmount } = renderHook(() => useIdleTimer({ timeoutMs: TIMEOUT, enabled: false }));
    act(() => vi.advanceTimersByTime(TIMEOUT * 2));
    expect(result.current.idle).toBe(false);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

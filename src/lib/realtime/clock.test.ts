import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("./client", () => {
  const handlers: ((p: unknown) => void)[] = [];
  return {
    realtimeClient: {
      subscribe: (_t: string, h: (p: unknown) => void) => (handlers.push(h), () => undefined),
    },
    __push: (p: unknown) => handlers.forEach((h) => h(p)),
  };
});

import * as client from "./client";
import { _resetClockForTests, now } from "./clock";
import { useCountdown } from "@/hooks/useCountdown";

const push = (client as unknown as { __push: (p: unknown) => void }).__push;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  _resetClockForTests();
});
afterEach(() => vi.useRealTimers());

describe("server clock", () => {
  it("corrects for an offset client clock", () => {
    const target = Date.now() + 10 * 60_000;
    const { result } = renderHook(() => useCountdown(target, 60_000));
    act(() => push({ now: Date.now() + 5 * 60_000 })); // client is 5 min behind server
    expect(now() - Date.now()).toBe(5 * 60_000);
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.remainingMs).toBe(4 * 60_000);
  });

  it("expires exactly at a boundary event and clamps to zero", () => {
    const target = Date.now() + 10_000;
    const { result } = renderHook(() => useCountdown(target, 60_000));
    expect(result.current.expired).toBe(false);
    act(() => push({ now: target + 1, boundary: true }));
    expect(result.current).toEqual({ remainingMs: 0, expired: true });
  });
});

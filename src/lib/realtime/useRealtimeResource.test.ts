// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let receive:
  ((update: { payload: unknown; sequence?: number; timestamp?: number }) => void) | undefined;
vi.mock("@/lib/flags/useFeatureFlag", () => ({ useFeatureFlag: () => true }));
vi.mock("./client", () => ({
  realtimeClient: {
    subscribe: (_topic: string, handler: typeof receive) => {
      receive = handler;
      return () => {};
    },
  },
}));
import { useRealtimeResource } from "./useRealtimeResource";

afterEach(() => {
  receive = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useRealtimeResource", () => {
  it("discards a late seed response, aborts it, and keeps the realtime value", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    let resolveSeed!: (value: { value: number; timestamp: number }) => void;
    let requestSignal!: AbortSignal;
    const fetcher = vi.fn((signal: AbortSignal) => {
      requestSignal = signal;
      return new Promise<{ value: number; timestamp: number }>((resolve) => {
        resolveSeed = resolve;
      });
    });
    const { result } = renderHook(() =>
      useRealtimeResource({
        topic: "race.topic",
        flag: "enabled",
        fetcher,
        getRestKey: (value) => ({ timestamp: value.timestamp }),
      })
    );
    act(() => receive?.({ payload: { value: 2, timestamp: 200 }, timestamp: 200 }));
    expect(requestSignal.aborted).toBe(true);
    await act(async () => {
      resolveSeed({ value: 1, timestamp: 100 });
    });
    expect(result.current.data).toEqual({ value: 2, timestamp: 200 });
    expect(result.current.error).toBeNull();
    expect(interval).not.toHaveBeenCalled();
  });

  it("renders the one-shot fixture fallback when REST fails", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() =>
      useRealtimeResource({
        topic: "fallback.topic",
        flag: "enabled",
        fetcher,
        fixture: () => ({ value: 4 }),
      })
    );
    await waitFor(() => expect(result.current.data).toEqual({ value: 4 }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.isFixture).toBe(true);
  });

  it("coalesces a protocol stats burst into one animation frame commit", async () => {
    let queued: FrameRequestCallback | undefined;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      queued = callback;
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const fetcher = vi.fn().mockResolvedValue({ value: 0 });
    const mergeEvent = (payload: unknown, current: { value: number } | null) =>
      current && typeof payload === "object" && payload && "delta" in payload
        ? { value: current.value + Number((payload as { delta: number }).delta) }
        : null;
    const { result } = renderHook(() =>
      useRealtimeResource({ topic: "protocol.stats", flag: "enabled", fetcher, mergeEvent })
    );
    await waitFor(() => expect(result.current.data).toEqual({ value: 0 }));
    act(() => {
      receive?.({ payload: { delta: 1 }, sequence: 1 });
      receive?.({ payload: { delta: 2 }, sequence: 2 });
      receive?.({ payload: { delta: 3 }, sequence: 3 });
    });
    expect(requestFrame).toHaveBeenCalledTimes(1);
    await act(async () => {
      queued?.(16);
    });
    expect(result.current.data).toEqual({ value: 6 });
  });
});

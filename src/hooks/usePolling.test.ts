import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "./usePolling";

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  afterEach(() => vi.useRealTimers());

  it("runs immediately and at the configured cadence", async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePolling(fetcher, 1000));
    await act(async () => Promise.resolve());
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("pauses while hidden and refreshes once on resume", async () => {
    const fetcher = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePolling(fetcher, 1000));
    await act(async () => Promise.resolve());
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(fetcher).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("skips ticks while a request is in flight and aborts on unmount", async () => {
    let resolve!: () => void;
    const fetcher = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((done) => {
          resolve = done;
          signal.addEventListener("abort", done);
        })
    );
    const hook = renderHook(() => usePolling(fetcher, 1000));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve();
    await act(async () => Promise.resolve());
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(fetcher).toHaveBeenCalledTimes(2);
    const signal = fetcher.mock.calls[1]?.[0];
    hook.unmount();
    expect(signal?.aborted).toBe(true);
  });
});

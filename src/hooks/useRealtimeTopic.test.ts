// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRealtimeTopic } from "./useRealtimeTopic";
import { realtimeClient } from "@/lib/realtime/client";
vi.mock("@/lib/realtime/client", () => ({ realtimeClient: { subscribe: vi.fn() } }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("debounces route changes and emits one replacement subscription regardless of rerenders", () => {
  vi.useFakeTimers();
  const off = vi.fn();
  vi.mocked(realtimeClient.subscribe).mockReturnValue(off);
  const hook = renderHook(
    ({ id }) => useRealtimeTopic("oracle_update", { entityIds: [id] }, () => {}),
    { initialProps: { id: "A" } }
  );
  act(() => vi.advanceTimersByTime(150));
  expect(realtimeClient.subscribe).toHaveBeenCalledTimes(1);
  hook.rerender({ id: "A" });
  hook.rerender({ id: "A" });
  expect(off).not.toHaveBeenCalled();
  hook.rerender({ id: "B" });
  hook.rerender({ id: "C" });
  hook.rerender({ id: "D" });
  expect(off).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(150));
  expect(realtimeClient.subscribe).toHaveBeenCalledTimes(2);
  expect(realtimeClient.subscribe).toHaveBeenLastCalledWith(
    "oracle_update",
    expect.any(Function),
    expect.objectContaining({ entityIds: ["D"] })
  );
  hook.unmount();
  expect(off).toHaveBeenCalledTimes(2);
});

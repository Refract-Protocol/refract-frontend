import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { realtimeClient } from "@/lib/realtime/client";
import { useRealtimeTopic } from "./useRealtimeTopic";

describe("useRealtimeTopic", () => {
  it("renders the cached value as stale, then updates on the next push", () => {
    realtimeClient.publish("oracle_update", { price: 1 }, "test");
    const { result } = renderHook(() => useRealtimeTopic<{ price: number }>("oracle_update"));
    expect(result.current.value).toEqual({ price: 1 });
    expect(result.current.stale).toBe(true);
    act(() => realtimeClient.publish("oracle_update", { price: 2 }, "test"));
    expect(result.current.value).toEqual({ price: 2 });
    expect(result.current.stale).toBe(false);
    realtimeClient.disconnect();
  });
});

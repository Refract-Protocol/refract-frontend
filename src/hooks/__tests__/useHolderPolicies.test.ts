import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const realtimeHandlers: Array<(event: unknown) => void> = [];

vi.mock("../useRealtimeRevalidation", () => ({
  useRealtimeRevalidation: ({ onEvent }: { onEvent: (e: unknown) => void }) => {
    realtimeHandlers.push(onEvent);
  },
}));

import { useHolderPolicies } from "../useHolderPolicies";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useHolderPolicies", () => {
  beforeEach(() => {
    realtimeHandlers.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("patches the cached list in place on a policy update event without refetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [
        { id: "p1", coverageType: "health", coverageAmount: "100", active: true },
        { id: "p2", coverageType: "flight", coverageAmount: "200", active: true },
      ],
    } as Response);

    const { result } = renderHook(() => useHolderPolicies("holder-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    act(() => {
      realtimeHandlers.forEach((handler) =>
        handler({ type: "policy_update", policyId: "p1", changes: { active: false } }),
      );
    });

    await waitFor(() => {
      const updated = result.current.data?.find((p) => p.id === "p1");
      expect(updated?.active).toBe(false);
    });

    // No additional network request should have been made.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

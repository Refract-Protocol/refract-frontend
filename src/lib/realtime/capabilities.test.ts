import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAPABILITY_STORAGE_KEY,
  clearRealtimeCapabilityCache,
  getLastCapabilityResult,
  getRealtimeCapability,
} from "./capabilities";

function createFakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, val: string) => {
      map.set(key, val);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe("Realtime Capability Detection & Transport Negotiation", () => {
  beforeEach(() => {
    clearRealtimeCapabilityCache(null);
  });

  it("negotiates WebSocket when supported by both backend and runtime, and memoizes in sessionStorage", async () => {
    const storage = createFakeStorage();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        supported: true,
        version: 1,
        transports: ["websocket", "sse"],
      }),
    } as unknown as Response);

    const first = await getRealtimeCapability({
      baseUrl: "https://api.refract.example/api/v1",
      fetchImpl: fetchMock,
      hasWebSocket: true,
      hasEventSource: true,
      storage,
      now: () => 10_000,
    });

    expect(first).toEqual({
      supported: true,
      negotiatedTransport: "websocket",
      availableTransports: ["websocket", "sse"],
      protocolVersion: 1,
      reason: "ok",
      probedAt: 10_000,
    });
    expect(getLastCapabilityResult()).toEqual(first);
    expect(storage.getItem(CAPABILITY_STORAGE_KEY)).toBeTruthy();

    // Second call uses session cache without firing another network request
    const second = await getRealtimeCapability({
      fetchImpl: fetchMock,
      storage,
    });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("downgrades cleanly to SSE when WebSocket is unavailable in runtime or omitted by backend", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        supported: true,
        version: 1,
        transports: ["websocket", "sse"],
      }),
    } as unknown as Response);

    const res = await getRealtimeCapability({
      fetchImpl: fetchMock,
      hasWebSocket: false,
      hasEventSource: true,
      storage: null,
    });

    expect(res.supported).toBe(true);
    expect(res.negotiatedTransport).toBe("sse");
    expect(res.reason).toBe("ws_unavailable_in_runtime");
  });

  it("falls back to REST-only on 404/unsupported backends, version mismatch, malformed JSON, and timeouts", async () => {
    const unsupportedFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as unknown as Response);

    const unsupported = await getRealtimeCapability({
      fetchImpl: unsupportedFetch,
      storage: null,
      forceRefresh: true,
    });
    expect(unsupported.supported).toBe(false);
    expect(unsupported.negotiatedTransport).toBe("rest");
    expect(unsupported.reason).toBe("backend_unsupported");

    const malformedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ invalid: "shape" }),
    } as unknown as Response);

    const malformed = await getRealtimeCapability({
      fetchImpl: malformedFetch,
      storage: null,
      forceRefresh: true,
    });
    expect(malformed.supported).toBe(false);
    expect(malformed.negotiatedTransport).toBe("rest");
    expect(malformed.reason).toBe("malformed_probe_response");

    const versionMismatchFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ supported: true, version: 2, transports: ["websocket"] }),
    } as unknown as Response);

    const mismatch = await getRealtimeCapability({
      fetchImpl: versionMismatchFetch,
      storage: null,
      forceRefresh: true,
    });
    expect(mismatch.supported).toBe(false);
    expect(mismatch.negotiatedTransport).toBe("rest");
    expect(mismatch.reason).toBe("protocol_version_incompatible");

    vi.useFakeTimers();
    const slowFetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const timeoutPromise = getRealtimeCapability({
      fetchImpl: slowFetch,
      timeoutMs: 300,
      storage: null,
      forceRefresh: true,
    });
    vi.advanceTimersByTime(350);
    const timedOut = await timeoutPromise;
    expect(timedOut.supported).toBe(false);
    expect(timedOut.negotiatedTransport).toBe("rest");
    expect(timedOut.reason).toBe("probe_timeout");
    vi.useRealTimers();
  });
});

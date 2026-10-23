import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cachedRequest, clearRequestCache } from "./requestCache";

beforeEach(() => {
  vi.useFakeTimers();
  clearRequestCache();
});
afterEach(() => vi.useRealTimers());

describe("cachedRequest", () => {
  it("shares one call between simultaneous callers", async () => {
    const fetcher = vi.fn().mockResolvedValue("a");
    const [x, y] = await Promise.all([cachedRequest("k", fetcher), cachedRequest("k", fetcher)]);
    expect([x, y]).toEqual(["a", "a"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps different keys independent", async () => {
    const fetcher = vi.fn((v: string) => Promise.resolve(v));
    await cachedRequest("holder:A", () => fetcher("A"));
    await cachedRequest("holder:B", () => fetcher("B"));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reuses within the TTL and refetches after it", async () => {
    const fetcher = vi.fn().mockResolvedValue(1);
    await cachedRequest("k", fetcher, 1000);
    vi.advanceTimersByTime(999);
    await cachedRequest("k", fetcher, 1000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    await cachedRequest("k", fetcher, 1000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue("ok");
    await expect(cachedRequest("k", fetcher)).rejects.toThrow("boom");
    await expect(cachedRequest("k", fetcher)).resolves.toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("clears a single key", async () => {
    const fetcher = vi.fn().mockResolvedValue(1);
    await cachedRequest("k", fetcher);
    clearRequestCache("k");
    await cachedRequest("k", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

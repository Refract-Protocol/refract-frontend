import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realtimeClient } from "../client";
import { MAX_PENDING_REQUESTS } from "../correlation";
import { installFakeRealtime, type FakeRealtime } from "../testing";

let fake: FakeRealtime;
let t: ReturnType<typeof installFakeRealtime>["current"];
beforeEach(() => {
  vi.useFakeTimers();
  fake = installFakeRealtime();
  realtimeClient.connect();
  t = fake.current;
});
afterEach(() => {
  fake.teardown();
  vi.useRealTimers();
});

const idOf = (n: number) => JSON.parse(t.sent[n]).id as number;

describe("request/response correlation", () => {
  it("resolves, clears the timeout and never leaks responses to topic listeners", async () => {
    const listener = vi.fn();
    realtimeClient.subscribe("snapshot", listener);
    const p = realtimeClient.request("snapshot", {}, { timeoutMs: 500 });
    t.respond(idOf(0), "ok");
    await expect(p).resolves.toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it("generates monotonic ids for concurrent requests", async () => {
    const a = realtimeClient.request("q");
    const b = realtimeClient.request("q");
    expect(idOf(1)).toBeGreaterThan(idOf(0));
    t.respond(idOf(1), "b");
    t.respond(idOf(0), "a");
    await expect(Promise.all([a, b])).resolves.toEqual(["a", "b"]);
  });

  it("times out", async () => {
    const p = realtimeClient.request("q", {}, { timeoutMs: 100 });
    const assertion = expect(p).rejects.toMatchObject({ reason: "timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("aborts via AbortSignal", async () => {
    const ac = new AbortController();
    const p = realtimeClient.request("q", {}, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ reason: "aborted" });
    await expect(realtimeClient.request("q", {}, { signal: ac.signal })).rejects.toMatchObject({ reason: "aborted" });
  });

  it("rejects in-flight requests on disconnect and ignores stale/duplicate ids", async () => {
    const p = realtimeClient.request("q");
    const id = idOf(0);
    t.drop();
    await expect(p).rejects.toMatchObject({ reason: "disconnected" });
    expect(() => {
      t.respond(id, "late");
      t.respond(id, "dup");
    }).not.toThrow();
    expect(vi.getTimerCount()).toBe(1); // only the reconnect timer remains
  });

  it("rejects pending requests and clears them on teardown", async () => {
    const p = realtimeClient.request("q");
    realtimeClient.disconnect();
    await expect(p).rejects.toMatchObject({ reason: "disconnected" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds the pending map", async () => {
    const ps = Array.from({ length: MAX_PENDING_REQUESTS }, () => realtimeClient.request("q"));
    await expect(realtimeClient.request("q")).rejects.toMatchObject({ reason: "overflow" });
    realtimeClient.disconnect();
    await Promise.allSettled(ps);
  });
});

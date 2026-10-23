import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realtimeClient } from "../client";
import { installFakeRealtime, type FakeRealtime } from "../testing";

let fake: FakeRealtime;
beforeEach(() => {
  vi.useFakeTimers();
  fake = installFakeRealtime();
});
afterEach(() => {
  fake.teardown();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
});

describe("fake transport kit", () => {
  it("delivers typed events to subscribers and unsubscribes cleanly", () => {
    const handler = vi.fn();
    const off = realtimeClient.subscribe("oracle_update", handler);
    fake.current.open();
    fake.current.emit("oracle_update", { severity: "triggered", value: 9 });
    expect(handler).toHaveBeenCalledWith({ severity: "triggered", value: 9 });
    off();
    fake.current.emit("oracle_update", { severity: "normal", value: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid payloads at the type level", () => {
    const t = fake.transports[0] ?? (realtimeClient.subscribe("x", () => {}), fake.current);
    // @ts-expect-error severity is not part of the contract
    t.emit("oracle_update", { severity: "bogus", value: 1 });
    // @ts-expect-error unknown topic
    t.emit("nope", {});
  });

  it("reconnects with backoff after a forced drop and supports StrictMode double-mount", () => {
    const a = realtimeClient.subscribe("oracle_update", () => {});
    a();
    const b = realtimeClient.subscribe("oracle_update", () => {});
    expect(fake.transports).toHaveLength(1);
    fake.current.drop();
    vi.advanceTimersByTime(1000);
    expect(fake.transports).toHaveLength(2);
    b();
  });

  it("leaves no timers after teardown mid-backoff", () => {
    realtimeClient.subscribe("oracle_update", () => {});
    fake.current.error();
    expect(vi.getTimerCount()).toBe(1);
    fake.teardown();
    expect(vi.getTimerCount()).toBe(0);
    fake = installFakeRealtime();
  });

  it("resolves requests via respond() and rejects on fail()", async () => {
    realtimeClient.subscribe("oracle_update", () => {});
    const t = fake.current;
    const ok = realtimeClient.request("snapshot", { a: 1 });
    const { id } = JSON.parse(t.sent[0]);
    t.respond(id, { v: 1 });
    await expect(ok).resolves.toEqual({ v: 1 });
    const bad = realtimeClient.request("snapshot");
    t.fail(JSON.parse(t.sent[1]).id, "E", "boom");
    await expect(bad).rejects.toMatchObject({ reason: "server", code: "E" });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeClient } from "./client";
import { compilePattern } from "./topics";
import { SessionIngress, validateEndpoint } from "./security";
import { RouteSubscriptions } from "./routes";
import { topicsForRoute } from "@/app/realtime-topics";

class Socket extends EventTarget {
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  fail = false;
  send(data: string) {
    if (this.fail) throw new Error("offline");
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  message(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
  auth(topics: string[] = [], wildcards = true) {
    this.open();
    this.message({
      type: "authenticated",
      version: 1,
      challenge: this.sent[0]!.challenge,
      session: "session-1234567890",
      topics,
      wildcards,
    });
  }
  event(topic: string, sequence = 0, extra = {}) {
    this.message({
      topic,
      payload: { value: 1 },
      session: "session-1234567890",
      sequence,
      timestamp: Date.now(),
      ...extra,
    });
  }
}
function setup(capacity = 256) {
  const sockets: Socket[] = [];
  const client = new RealtimeClient({
    url: "wss://example.com/ws",
    origin: "https://example.com",
    capacity,
    socket: () => {
      const s = new Socket();
      sockets.push(s);
      return s as unknown as WebSocket;
    },
  });
  return { client, sockets };
}
afterEach(() => vi.useRealTimers());
describe("topic grammar", () => {
  it.each([
    ["pool.one", "pool.one", true],
    ["pool.*", "pool.one", true],
    ["pool.*", "pool.one.two", false],
    ["pool.**", "pool", true],
    ["pool.**", "pool.one.two", true],
    ["pool.*", "claim.one", false],
    ["pool.one", "pool.two", false],
  ])("%s against %s", (pattern, topic, expected) =>
    expect(compilePattern(pattern)(topic)).toBe(expected)
  );
  it.each(["", "pool..one", "pool.**.one", "pool.o*", "pool/", ".pool"])("rejects %s", (pattern) =>
    expect(() => compilePattern(pattern)).toThrow("Invalid")
  );
});
describe("ingress security", () => {
  it("cannot allow insecure production transport through mock flags", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_MOCKING", "enabled");
    try {
      expect(() =>
        validateEndpoint("ws://localhost:4001/ws", "http://localhost:3000", ["ws://localhost:4001"])
      ).toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("validates scheme, host and port; permits explicit origin", () => {
    expect(validateEndpoint("wss://app.test/ws", "https://app.test").host).toBe("app.test");
    for (const url of [
      "ws://app.test/ws",
      "wss://evil.test/ws",
      "wss://app.test:444/ws",
      "wss://user:pass@app.test/ws",
    ])
      expect(() => validateEndpoint(url, "https://app.test")).toThrow();
    expect(validateEndpoint("wss://api.test/ws", "https://app.test", ["wss://api.test"]).host).toBe(
      "api.test"
    );
  });
  it("checks session, replay and clock tolerance", () => {
    const ingress = new SessionIngress("trusted", () => 100000);
    const event = { session: "trusted", sequence: 1, timestamp: 40000 };
    expect(ingress.accept({ ...event, session: "forged" })).toBe(false);
    expect(ingress.accept({ ...event, timestamp: 39999 })).toBe(false);
    expect(ingress.accept(event)).toBe(true);
    expect(ingress.accept(event)).toBe(false);
    expect(ingress.accept({ ...event, sequence: 2, timestamp: 160000 })).toBe(true);
  });
  it("drops unsigned, forged and replayed events before subscribers", () => {
    const { client, sockets } = setup();
    const handler = vi.fn();
    client.subscribe("oracle_update", handler);
    const socket = sockets[0]!;
    socket.message({ topic: "oracle_update", payload: 0 });
    socket.auth();
    socket.event("oracle_update", 0, { session: "forged" });
    socket.event("oracle_update");
    socket.event("oracle_update");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(client.diagnostics.rejected).toBe(3);
    client.disconnect();
  });
  it("rejects malformed handshake and never flushes before auth", () => {
    const { client, sockets } = setup();
    client.subscribe("pool_update", vi.fn());
    sockets[0]!.open();
    sockets[0]!.message({ type: "authenticated", challenge: "forged" });
    expect(sockets[0]!.sent.map((f) => f.type)).toEqual(["auth"]);
    expect(client.diagnostics.rejected).toBe(1);
    client.disconnect();
  });
});
describe("desired-state replay", () => {
  it("preserves unsubscribe/subscribe ordering across a disconnect", () => {
    vi.useFakeTimers();
    const { client, sockets } = setup();
    const offA = client.subscribe("a", vi.fn());
    const offC = client.subscribe("c", vi.fn());
    sockets[0]!.auth();
    sockets[0]!.close();
    offA();
    client.subscribe("b", vi.fn());
    offC();
    vi.advanceTimersByTime(1000);
    sockets[1]!.auth(["a", "c"]);
    expect(sockets[1]!.sent.slice(1)).toEqual([
      { type: "unsubscribe", topic: "a" },
      { type: "subscribe", topic: "b" },
      { type: "unsubscribe", topic: "c" },
    ]);
    client.disconnect();
  });
  it("reconciles all final intents when ordering queue overflows", () => {
    vi.useFakeTimers();
    const { client, sockets } = setup(2);
    const offA = client.subscribe("a", vi.fn());
    const offB = client.subscribe("b", vi.fn());
    sockets[0]!.auth();
    sockets[0]!.close();
    offA();
    offB();
    client.subscribe("c", vi.fn());
    expect(client.diagnostics.overflow).toBe(1);
    vi.advanceTimersByTime(1000);
    sockets[1]!.auth(["a", "b"]);
    expect(sockets[1]!.sent.slice(1)).toEqual([
      { type: "subscribe", topic: "c" },
      { type: "unsubscribe", topic: "a" },
      { type: "unsubscribe", topic: "b" },
    ]);
    client.disconnect();
  });

  it("replays in insertion order after auth and collapses toggles against resume", () => {
    vi.useFakeTimers();
    const { client, sockets } = setup();
    const off = client.subscribe("pool_update", vi.fn());
    sockets[0]!.auth();
    sockets[0]!.close();
    off();
    const remove = client.subscribe("claim_update", vi.fn());
    remove();
    client.subscribe("oracle_update", vi.fn());
    client.subscribe("claim_update", vi.fn());
    vi.advanceTimersByTime(1000);
    sockets[1]!.auth(["pool_update", "oracle_update"]);
    expect(sockets[1]!.sent.map((f) => [f.type, f.topic])).toEqual([
      ["auth", undefined],
      ["unsubscribe", "pool_update"],
      ["subscribe", "claim_update"],
    ]);
    client.disconnect();
  });
  it("reference counts and delivers once per registration across exact and pattern interests", () => {
    const { client, sockets } = setup();
    const handler = vi.fn();
    const a = client.subscribe("pool_update", handler);
    const b = client.subscribe("*", handler);
    sockets[0]!.auth([], false);
    sockets[0]!.event("pool_update");
    expect(handler).toHaveBeenCalledTimes(2); // two distinct registrations, once each
    expect(sockets[0]!.sent.filter((f) => f.topic === "pool_update")).toHaveLength(1);
    a();
    expect(sockets[0]!.sent.filter((f) => f.type === "unsubscribe")).toHaveLength(0);
    b();
    expect(sockets[0]!.sent.filter((f) => f.type === "unsubscribe")).toHaveLength(3);
    client.disconnect();
  });
  it("bounds desired state, counts overflow, and does not grow on offline toggles", () => {
    const { client } = setup(1);
    const off = client.subscribe("a", vi.fn());
    expect(() => client.subscribe("b", vi.fn())).toThrow("capacity");
    expect(client.diagnostics.overflow).toBe(1);
    off();
    expect(() => client.subscribe("b", vi.fn())).not.toThrow();
    client.disconnect();
  });
  it("discards state and reconnect timers on logout; old disposers are harmless", () => {
    vi.useFakeTimers();
    const { client, sockets } = setup();
    const old = client.subscribe("a", vi.fn());
    sockets[0]!.close();
    client.authenticate("secret");
    client.disconnect();
    vi.runAllTimers();
    expect(sockets).toHaveLength(1);
    client.subscribe("a", vi.fn());
    old();
    sockets[1]!.auth();
    expect(sockets[1]!.sent).toEqual([
      expect.objectContaining({ type: "auth", credential: null }),
      { type: "subscribe", topic: "a" },
    ]);
    client.disconnect();
  });
  it("keeps a shared topic until its final owner releases", () => {
    const { client, sockets } = setup();
    const a = client.subscribe("pool_update", vi.fn());
    const b = client.subscribe("pool_update", vi.fn());
    sockets[0]!.auth();
    a();
    expect(sockets[0]!.sent.filter((f) => f.type === "unsubscribe")).toHaveLength(0);
    b();
    expect(sockets[0]!.sent.filter((f) => f.type === "unsubscribe")).toHaveLength(1);
    client.disconnect();
  });
  it("sends the latest offline auth intent before topic mutations", () => {
    vi.useFakeTimers();
    const { client, sockets } = setup();
    client.subscribe("a", vi.fn());
    sockets[0]!.auth();
    sockets[0]!.close();
    client.authenticate("old");
    client.authenticate("latest");
    vi.advanceTimersByTime(1000);
    sockets[1]!.auth();
    expect(sockets[1]!.sent).toEqual([
      expect.objectContaining({ type: "auth", credential: "latest" }),
      { type: "subscribe", topic: "a" },
    ]);
    client.disconnect();
  });
  it("does not spin when a flush send fails", () => {
    vi.useFakeTimers();
    const { client, sockets } = setup();
    client.subscribe("a", vi.fn());
    sockets[0]!.open();
    sockets[0]!.fail = true;
    sockets[0]!.message({
      type: "authenticated",
      version: 1,
      challenge: sockets[0]!.sent[0]!.challenge,
      session: "session-1234567890",
      topics: [],
      wildcards: true,
    });
    expect(client.diagnostics.transport).toBe(1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    sockets[1]!.auth();
    expect(sockets[1]!.sent[1]).toEqual({ type: "subscribe", topic: "a" });
    client.disconnect();
  });
});
describe("route ownership", () => {
  it("cannot resurrect snapshot or prefetch interests after logout", async () => {
    vi.useFakeTimers();
    const { client, sockets } = setup();
    const resolvers: Array<() => void> = [];
    const routes = new RouteSubscriptions(
      client,
      () => new Promise<void>((resolve) => resolvers.push(resolve))
    );
    routes.navigate("/cover");
    routes.prefetch("/provide");
    await vi.advanceTimersByTimeAsync(40);
    client.disconnect();
    resolvers.forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(0);
    routes.dispose();
  });
  it("reacquires route owners on navigation after explicit teardown", async () => {
    vi.useFakeTimers();
    const { client, sockets } = setup();
    const routes = new RouteSubscriptions(client);
    routes.navigate("/cover");
    await vi.advanceTimersByTimeAsync(40);
    sockets[0]!.auth();
    client.disconnect();
    routes.navigate("/provide");
    await vi.advanceTimersByTimeAsync(40);
    sockets[1]!.auth();
    expect(sockets[1]!.sent.slice(1)).toEqual([
      { type: "subscribe", topic: "pool_update" },
      { type: "subscribe", topic: "claim_update" },
    ]);
    routes.dispose();
    client.disconnect();
  });
  it("warms link intent without rendering and releases only its own references", async () => {
    vi.useFakeTimers();
    const { client, sockets } = setup();
    const routes = new RouteSubscriptions(client);
    routes.prefetch("/cover");
    routes.prefetch("/cover/buy");
    await vi.advanceTimersByTimeAsync(0);
    sockets[0]!.auth();
    expect(sockets[0]!.sent.filter((frame) => frame.type === "subscribe")).toHaveLength(2);
    routes.navigate("/provide");
    await vi.advanceTimersByTimeAsync(40);
    await vi.advanceTimersByTimeAsync(4960);
    expect(sockets[0]!.sent.filter((frame) => frame.type === "unsubscribe")).toEqual([
      { type: "unsubscribe", topic: "oracle_update" },
    ]);
    routes.dispose();
    client.disconnect();
  });

  it("inherits nested routes and leaves unknown routes to hooks", () => {
    expect(topicsForRoute("/cover/buy")).toEqual(topicsForRoute("/cover"));
    expect(topicsForRoute("/coverage")).toEqual([]);
    expect(topicsForRoute("/unknown")).toEqual([]);
  });
  it("preserves shared interests and batches rapid navigation", async () => {
    vi.useFakeTimers();
    const interests = new Set<string>();
    const releases: string[] = [];
    const subscribe = vi.fn((topic: string) => {
      interests.add(topic);
      return () => {
        interests.delete(topic);
        releases.push(topic);
      };
    });
    const snapshot = vi.fn(async () => undefined);
    const routes = new RouteSubscriptions({ subscribe }, snapshot);
    routes.navigate("/");
    await vi.advanceTimersByTimeAsync(40);
    expect([...interests]).toEqual(["oracle_update", "pool_update", "claim_update"]);
    routes.navigate("/cover");
    routes.navigate("/");
    routes.navigate("/provide");
    await vi.advanceTimersByTimeAsync(40);
    expect([...interests]).toEqual(["pool_update", "claim_update"]);
    expect(releases).toEqual(["oracle_update"]);
    expect(subscribe).toHaveBeenCalledTimes(3);
    routes.navigate("/unknown");
    await vi.advanceTimersByTimeAsync(40);
    expect(interests.size).toBe(0);
    routes.dispose();
  });
  it("ignores stale snapshot completion", async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const subscribe = vi.fn(() => vi.fn());
    const routes = new RouteSubscriptions(
      { subscribe },
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    routes.navigate("/cover");
    await vi.advanceTimersByTimeAsync(40);
    routes.navigate("/unknown");
    resolve();
    await vi.advanceTimersByTimeAsync(40);
    expect(subscribe).not.toHaveBeenCalled();
    routes.dispose();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeClient } from "./client";
import { jsonCodec, tupleCodec, selectCodec } from "./codecs";
import { descriptor, matches, type Message } from "./contract";
import { EndpointSelector } from "./endpoints";
import { Scheduler } from "./scheduler";
import { realtimeEndpoints } from "../network";
class MockSocket {
  static instances: MockSocket[] = [];
  readyState = 0;
  protocol = "";
  binaryType = "";
  sent: (string | ArrayBuffer)[] = [];
  listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
  constructor(
    public url: string,
    public protocols: string[]
  ) {
    MockSocket.instances.push(this);
  }
  addEventListener(name: string, fn: (event: { data?: unknown }) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  emit(name: string, data?: unknown) {
    this.listeners.get(name)?.forEach((fn) => fn({ data }));
  }
  open(protocol = "") {
    this.readyState = 1;
    this.protocol = protocol;
    this.emit("open");
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  message(m: Message) {
    this.emit("message", JSON.stringify(m));
  }
}
const bulk = (n: number): Message => ({
  topic: "oracle_update",
  payload: n,
  entityId: "A",
  version: n,
});
const critical = (n: number): Message => ({ topic: "claim_settlement", payload: n });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  MockSocket.instances = [];
});
describe("priority scheduling", () => {
  it("overtakes 2000 bulk events, preserves order, and reports bounded critical latency", async () => {
    const output: Message[] = [];
    const scheduler = new Scheduler(
      (m) => output.push(m),
      () => 2,
      () => {}
    );
    for (let i = 0; i < 2000; i++) scheduler.enqueue(bulk(i));
    scheduler.enqueue(critical(0));
    scheduler.enqueue(critical(1));
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(output.slice(0, 2)).toEqual([critical(0), critical(1)]);
    expect(output.filter((m) => m.topic === "oracle_update").map((m) => m.payload)).toEqual(
      Array.from({ length: 2000 }, (_, i) => i)
    );
    expect(scheduler.metrics.worstCriticalLatencyMs).toBeLessThan(50);
    console.log(
      "Synthetic 2000-event burst: critical worst ms",
      scheduler.metrics.worstCriticalLatencyMs
    );
  });
  it("services bulk after at most eight critical deliveries and bounds each class", async () => {
    const output: Message[] = [];
    const scheduler = new Scheduler(
      (m) => output.push(m),
      () => 2,
      () => {},
      100
    );
    for (let i = 0; i < 110; i++) {
      scheduler.enqueue(critical(i));
      scheduler.enqueue(bulk(i));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(output[8]?.topic).toBe("oracle_update");
    expect(output).toHaveLength(200);
    expect(scheduler.metrics).toMatchObject({ droppedCritical: 10, droppedBulk: 10 });
  });
  it("passes through synchronously with one topic and clears pending work", async () => {
    const handler = vi.fn();
    const scheduler = new Scheduler(handler, () => 1);
    scheduler.enqueue(bulk(0));
    expect(handler).toHaveBeenCalledTimes(1);
    const queued = new Scheduler(handler, () => 2);
    queued.enqueue(bulk(1));
    queued.clear();
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
describe("codec contract", () => {
  it.each(["refract.json.v1", "refract.tuple.v1", "", "unsupported"])(
    "negotiates %s",
    (protocol) => {
      expect(selectCodec(protocol)).toBe(
        protocol === tupleCodec.subprotocol ? tupleCodec : jsonCodec
      );
    }
  );
  it("round trips both codecs into the same validated envelope with smaller binary payloads", () => {
    const message: Message = {
      topic: "oracle_update",
      payload: { value: 0.99 },
      entityId: "USDC",
      version: 20,
      timestamp: 123,
    };
    expect(jsonCodec.decode(jsonCodec.encode(message))).toEqual(message);
    expect(tupleCodec.decode(tupleCodec.encode(message))).toEqual(message);
    const json = jsonCodec.encode(message) as string;
    const compact = tupleCodec.encode(message) as ArrayBuffer;
    expect(json).toBe(JSON.stringify(message));
    expect(compact.byteLength).toBeLessThan(json.length);
    console.log("Envelope bytes JSON / tuple", json.length, compact.byteLength);
    expect(() => jsonCodec.decode('{"topic":"bogus","payload":1}')).toThrow();
  });
});
describe("interests", () => {
  it("normalizes equivalent descriptors and rejects accidental broad interests", () => {
    expect(descriptor("oracle_update", { entityIds: ["B", "A", "A"] })).toEqual(
      descriptor("oracle_update", { entityIds: ["A", "B"] })
    );
    expect(() => descriptor("oracle_update", { entityIds: [" "] })).toThrow();
    expect(() => descriptor("oracle_update", { fields: ["value"] })).toThrow();
    expect(() => descriptor("oracle_update", { minVersion: 0 })).toThrow();
    expect(() => descriptor("oracle_update", { minTimestamp: 0 })).toThrow();
    expect(matches(bulk(2), { entityIds: ["B"] })).toBe(false);
    expect(matches(bulk(2), { minVersion: 3 })).toBe(false);
    expect(matches(bulk(2), { minTimestamp: 0 })).toBe(false);
  });
});
describe("endpoint selection", () => {
  it("fails over in order, records health and returns to preferred", () => {
    let now = 0;
    const endpoints = new EndpointSelector(["a", "b", "c"], () => now);
    expect(endpoints.select().url).toBe("a");
    endpoints.failed(endpoints.select());
    expect(endpoints.select().url).toBe("b");
    endpoints.failed(endpoints.select());
    expect(endpoints.select().url).toBe("c");
    endpoints.succeeded(endpoints.select(), 15);
    expect(endpoints.select()).toMatchObject({ url: "c", firstMessageMs: 15, lastSuccess: 0 });
    now = 60_000;
    expect(endpoints.select().url).toBe("a");
    expect(new EndpointSelector(["a", "b"]).select().failures).toBe(0);
  });
  it("scores recent success and first-message latency and isolates network health", () => {
    const endpoints = new EndpointSelector(["a", "b"], () => 5000);
    endpoints.succeeded(endpoints.health[0]!, 100);
    endpoints.succeeded(endpoints.health[1]!, 10);
    expect(endpoints.select().url).toBe("b");
    vi.stubEnv(
      "NEXT_PUBLIC_REALTIME_ENDPOINTS",
      JSON.stringify({ testnet: ["wss://test/ws"], mainnet: ["wss://main/ws"] })
    );
    const testnet = new EndpointSelector(realtimeEndpoints("https://api/api/v1", "testnet"));
    testnet.failed(testnet.select());
    const mainnet = new EndpointSelector(realtimeEndpoints("https://api/api/v1", "mainnet"));
    expect(mainnet.select()).toMatchObject({ url: "wss://main/ws", failures: 0 });
  });
  it("derives endpoints by network", () => {
    expect(realtimeEndpoints("https://example.com/api/v1", "testnet")).toEqual([
      "wss://example.com/ws",
    ]);
  });
});
describe("mock server integration", () => {
  function setup() {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockSocket);
    return new RealtimeClient(["ws://primary", "ws://fallback"]);
  }
  it("settles on a healthy fallback, then probes primary without overlapping sockets", () => {
    const client = setup();
    const handler = vi.fn();
    client.subscribe("oracle_update", handler, { entityIds: ["A"] });
    MockSocket.instances[0]!.close();
    vi.advanceTimersByTime(1000);
    const fallback = MockSocket.instances[1]!;
    expect(fallback.url).toBe("ws://fallback");
    fallback.open();
    fallback.message(bulk(1));
    expect(handler).toHaveBeenCalledWith(1);
    vi.advanceTimersByTime(60_000);
    expect(fallback.readyState).toBe(3);
    vi.advanceTimersByTime(1000);
    const primary = MockSocket.instances[2]!;
    expect(primary.url).toBe("ws://primary");
    primary.open();
    primary.message(bulk(2));
    expect(handler).toHaveBeenLastCalledWith(2);
    expect(client.selectedEndpoint).toBe("ws://primary");
    expect(client.endpoints.health[0]!.failures).toBe(0);
    client.disconnect();
  });
  it.each(["", "refract.json.v1", "refract.tuple.v1", "unknown"])(
    "adopts %s, shares subscriptions, filters defensively",
    (protocol) => {
      const client = setup();
      const handler = vi.fn();
      const off = client.subscribe("oracle_update", handler, { entityIds: ["A"], minVersion: 2 });
      const off2 = client.subscribe("oracle_update", handler, { entityIds: ["A"], minVersion: 2 });
      const socket = MockSocket.instances[0]!;
      socket.open(protocol);
      expect(socket.protocols).toEqual([jsonCodec.subprotocol, tupleCodec.subprotocol]);
      expect(socket.sent).toHaveLength(1);
      const codec = selectCodec(protocol);
      socket.emit("message", codec.encode(bulk(1)));
      socket.emit("message", codec.encode({ ...bulk(2), entityId: "B" }));
      socket.emit("message", codec.encode(bulk(2)));
      expect(handler).toHaveBeenCalledTimes(2);
      off();
      expect(socket.sent).toHaveLength(1);
      off2();
      expect(socket.sent).toHaveLength(2);
      expect(socket.readyState).toBe(3);
    }
  );
  it("isolates subscriber errors and ignores malformed frames", () => {
    const client = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = vi.fn();
    client.subscribe(
      "oracle_update",
      () => {
        throw new Error("subscriber");
      },
      { broad: true }
    );
    client.subscribe("oracle_update", handler, { broad: true });
    const socket = MockSocket.instances[0]!;
    socket.open();
    socket.emit("message", "invalid");
    socket.message(bulk(1));
    expect(handler).toHaveBeenCalledWith(1);
    expect(error).toHaveBeenCalledTimes(1);
    client.disconnect();
    error.mockRestore();
  });
  it("returns to fallback if the periodic preferred trial still refuses", () => {
    const client = setup();
    client.subscribe("oracle_update", () => {}, { broad: true });
    MockSocket.instances[0]!.close();
    vi.advanceTimersByTime(1000);
    const fallback = MockSocket.instances[1]!;
    fallback.open();
    fallback.message(bulk(1));
    vi.advanceTimersByTime(61_000);
    MockSocket.instances[2]!.close();
    vi.advanceTimersByTime(2000);
    expect(MockSocket.instances[3]!.url).toBe("ws://fallback");
    MockSocket.instances[3]!.open();
    expect(MockSocket.instances[3]!.sent).toHaveLength(1);
    client.disconnect();
  });
  it("times out silent endpoints and cancels reconnect on disconnect", () => {
    const client = setup();
    client.subscribe("oracle_update", () => {}, { broad: true });
    MockSocket.instances[0]!.open();
    vi.advanceTimersByTime(11_000);
    expect(MockSocket.instances[1]!.url).toBe("ws://fallback");
    client.disconnect();
    vi.advanceTimersByTime(100_000);
    expect(MockSocket.instances).toHaveLength(2);
  });
});

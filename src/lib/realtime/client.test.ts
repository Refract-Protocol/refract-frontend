import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PERMESSAGE_DEFLATE_OPTIONS, RealtimeClient } from "./client";
import { ClockOffsetEstimator } from "./clockOffset";
import { MAX_MESSAGE_BYTES, type RealtimeProtocolError } from "./codec";
import { FakeWebSocket } from "./dev/fakeSocket";
import { INTERNAL_TOPICS } from "./topics";

function makeClient(opts: { maxMessageBytes?: number; clock?: ClockOffsetEstimator } = {}) {
  return new RealtimeClient({
    url: "ws://test/ws",
    WebSocketImpl: FakeWebSocket as never,
    heartbeatIntervalMs: 1_000,
    ...opts,
  });
}

beforeEach(() => {
  FakeWebSocket.reset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("RealtimeClient", () => {
  it("delivers payloads and envelopes to topic subscribers", () => {
    const client = makeClient();
    const handler = vi.fn();
    client.subscribe("oracle_update", handler);
    const ws = FakeWebSocket.latest();
    ws.open();
    ws.push("oracle_update", { price: 1 }, 123);
    ws.push("other", { price: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      { price: 1 },
      { topic: "oracle_update", payload: { price: 1 }, ts: 123 }
    );
  });

  it("stops delivering after unsubscribe", () => {
    const client = makeClient();
    const handler = vi.fn();
    const off = client.subscribe("t", handler);
    FakeWebSocket.latest().open();
    off();
    FakeWebSocket.latest().push("t", 1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps delivering to other subscribers when one throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = makeClient();
    const good = vi.fn();
    client.subscribe("t", () => {
      throw new Error("boom");
    });
    client.subscribe("t", good);
    FakeWebSocket.latest().open();
    FakeWebSocket.latest().push("t", 1);
    expect(good).toHaveBeenCalled();
  });

  describe("payload size guard", () => {
    it("drops oversize frames, counts them and reports a protocol error", () => {
      const client = makeClient({ maxMessageBytes: 64 });
      const handler = vi.fn();
      const onError = vi.fn<(e: RealtimeProtocolError) => void>();
      client.subscribe("t", handler);
      client.onProtocolError(onError);
      const ws = FakeWebSocket.latest();
      ws.open();

      ws.push("t", "x".repeat(100));
      expect(handler).not.toHaveBeenCalled();
      expect(client.getDiagnostics().oversizeDrops).toBe(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0].code).toBe("oversize");
      expect(client.getDiagnostics().lastError?.code).toBe("oversize");

      // The connection keeps working for normal frames.
      ws.push("t", "ok");
      expect(handler).toHaveBeenCalledWith("ok", expect.anything());
    });

    it("accepts a frame exactly at the limit and rejects one byte over", () => {
      const client = makeClient();
      const handler = vi.fn();
      client.subscribe("t", handler);
      const ws = FakeWebSocket.latest();
      ws.open();
      const shell = JSON.stringify({ topic: "t", payload: "" }).length;
      ws.receiveRaw(JSON.stringify({ topic: "t", payload: "x".repeat(MAX_MESSAGE_BYTES - shell) }));
      ws.receiveRaw(
        JSON.stringify({ topic: "t", payload: "x".repeat(MAX_MESSAGE_BYTES - shell + 1) })
      );
      expect(handler).toHaveBeenCalledTimes(1);
      expect(client.getDiagnostics().oversizeDrops).toBe(1);
    });

    it("counts malformed frames separately", () => {
      const client = makeClient();
      client.subscribe("t", vi.fn());
      const ws = FakeWebSocket.latest();
      ws.open();
      ws.receiveRaw("{not json");
      expect(client.getDiagnostics()).toMatchObject({ malformedDrops: 1, oversizeDrops: 0 });
    });

    it("tracks decoded byte counts", () => {
      const client = makeClient();
      client.subscribe("t", vi.fn());
      const ws = FakeWebSocket.latest();
      ws.open();
      const frame = JSON.stringify({ topic: "t", payload: "hello" });
      ws.receiveRaw(frame);
      expect(client.getDiagnostics()).toMatchObject({
        framesReceived: 1,
        bytesReceived: frame.length,
      });
    });
  });

  describe("permessage-deflate", () => {
    it("asks for deflate with no context takeover", () => {
      makeClient().connect();
      expect(FakeWebSocket.latest().options).toEqual(PERMESSAGE_DEFLATE_OPTIONS);
    });

    it("reports compression when the server accepts the extension", () => {
      const client = makeClient();
      client.connect();
      FakeWebSocket.latest().open(
        "permessage-deflate; client_no_context_takeover; server_no_context_takeover"
      );
      expect(client.getDiagnostics()).toMatchObject({
        compressionActive: true,
        negotiatedExtensions:
          "permessage-deflate; client_no_context_takeover; server_no_context_takeover",
      });
    });

    it("keeps working when the server declines compression", () => {
      const client = makeClient();
      const handler = vi.fn();
      client.subscribe("t", handler);
      const ws = FakeWebSocket.latest();
      ws.open("");
      ws.push("t", 1);
      expect(client.getDiagnostics()).toMatchObject({
        compressionActive: false,
        negotiatedExtensions: "",
      });
      expect(handler).toHaveBeenCalled();
    });

    it("records server-reported compressed/uncompressed byte counts", () => {
      const client = makeClient();
      client.connect();
      const ws = FakeWebSocket.latest();
      ws.open("permessage-deflate");
      ws.push(INTERNAL_TOPICS.WIRE_STATS, { compressedBytes: 1_200, uncompressedBytes: 9_600 });
      expect(client.getDiagnostics().wireStats).toEqual({
        compressedBytes: 1_200,
        uncompressedBytes: 9_600,
      });
    });
  });

  describe("heartbeat / clock sync", () => {
    it("pings on open and on every heartbeat", () => {
      vi.useFakeTimers();
      const client = makeClient();
      client.connect();
      const ws = FakeWebSocket.latest();
      ws.open();
      expect(ws.sent).toHaveLength(1);
      expect(ws.sent[0]).toMatchObject({
        topic: INTERNAL_TOPICS.PING,
        payload: { t0: expect.any(Number) },
      });
      vi.advanceTimersByTime(2_000);
      expect(ws.sent).toHaveLength(3);
      client.disconnect();
      vi.advanceTimersByTime(5_000);
      expect(ws.sent).toHaveLength(3);
    });

    it("feeds pong round trips into the clock estimator and never exposes internal topics", () => {
      const clock = new ClockOffsetEstimator();
      const client = makeClient({ clock });
      const handler = vi.fn();
      client.subscribe(INTERNAL_TOPICS.PONG, handler);
      const ws = FakeWebSocket.latest();
      ws.open();
      const t0 = Date.now();
      ws.push(INTERNAL_TOPICS.PONG, { t0, serverTs: t0 + 60_000 });
      expect(clock.getSnapshot().sampleCount).toBe(1);
      expect(Math.abs(clock.getSnapshot().offsetMs - 60_000)).toBeLessThan(1_000);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  it("reconnects with backoff after an unexpected close", () => {
    vi.useFakeTimers();
    const client = makeClient();
    client.connect();
    FakeWebSocket.latest().open();
    FakeWebSocket.latest().close();
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });
});

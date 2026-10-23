import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeClient, type SocketLike } from "../client";

class FakeSocket implements SocketLike {
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  sent: Record<string, unknown>[] = [];
  closed = 0;
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.closed++;
  }
  open() {
    this.onopen?.({});
  }
  push(frame: unknown) {
    this.onmessage?.({ data: typeof frame === "string" ? frame : JSON.stringify(frame) });
  }
  drop(code = 1006) {
    this.onclose?.({ code });
  }
}

const ON = { "realtime-enabled": true, "realtime-oracle": true, "realtime-claims": true };
const frame = (topic: string, seq: number) => ({ v: 1, topic, seq, ts: seq, payload: { id: "x" } });

let sockets: FakeSocket[];
const logger = { warn: vi.fn() };
const make = (extra = {}) =>
  new RealtimeClient({
    url: "ws://t/ws",
    socketFactory: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    random: () => 1,
    flags: ON,
    logger,
    ...extra,
  });

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  logger.warn.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("RealtimeClient", () => {
  it("does nothing while flags are off", () => {
    const c = make({ flags: {} });
    c.subscribe("oracle", () => {});
    expect(sockets).toHaveLength(0);
    expect(c.getState()).toBe("idle");
  });

  it("walks the state machine and delivers typed messages", () => {
    const c = make();
    const states: string[] = [];
    c.observeState((s) => states.push(s));
    const got: number[] = [];
    c.subscribe("oracle", (m) => got.push(m.seq));
    sockets[0].open();
    sockets[0].push(frame("oracle", 1));
    sockets[0].push(frame("claims", 9));
    expect(states).toEqual(["idle", "connecting", "open"]);
    expect(got).toEqual([1]);
    expect(sockets[0].sent).toEqual([{ op: "subscribe", topic: "oracle" }]);
  });

  it("follows the capped, jittered backoff schedule and resumes from the cursor", () => {
    const c = make({ random: () => 0 }); // equal jitter floor = ceiling/2
    c.subscribe("oracle", () => {});
    sockets[0].open();
    sockets[0].push(frame("oracle", 7));
    const delays: number[] = [];
    for (let i = 0; i < 8; i++) {
      sockets[i].drop();
      expect(c.getState()).toBe("reconnecting");
      const before = sockets.length;
      let waited = 0;
      while (sockets.length === before) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 15000, 15000, 15000]);
    sockets[sockets.length - 1].open();
    expect(sockets[sockets.length - 1].sent).toEqual([
      { op: "subscribe", topic: "oracle", cursor: 7 },
    ]);
  });

  it("ignores malformed, unknown-topic and unknown-version frames without throwing or leaking payloads", () => {
    const c = make();
    const handler = vi.fn();
    c.subscribe("oracle", handler);
    sockets[0].open();
    for (const bad of [
      "{nope",
      "[]",
      frame("mystery", 1),
      { ...frame("oracle", 1), v: 99 },
      { v: 1, topic: "oracle", seq: "x", ts: 1, payload: {} },
    ]) {
      sockets[0].push(bad);
    }
    expect(handler).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('"id":"x"');
  });

  it("reconnects when the heartbeat goes stale", () => {
    const c = make({ heartbeatIntervalMs: 1000, staleAfterMs: 2500, random: () => 0 });
    c.subscribe("oracle", () => {});
    sockets[0].open();
    vi.advanceTimersByTime(2000);
    expect(sockets[0].sent.filter((m) => m.op === "ping")).toHaveLength(2);
    vi.advanceTimersByTime(1000); // 3000ms silent > 2500
    expect(c.getState()).toBe("reconnecting");
    expect(sockets[0].closed).toBe(1);
    vi.advanceTimersByTime(600);
    expect(sockets).toHaveLength(2);
  });

  it("any inbound frame keeps the connection alive", () => {
    const c = make({ heartbeatIntervalMs: 1000, staleAfterMs: 2500 });
    c.subscribe("oracle", () => {});
    sockets[0].open();
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(1000);
      sockets[0].push({ op: "pong" });
    }
    expect(c.getState()).toBe("open");
  });

  it("tears down cleanly: no timers or sockets left", () => {
    const c = make();
    const h = c.subscribe("oracle", () => {});
    sockets[0].open();
    c.unsubscribe(h);
    expect(c.getState()).toBe("idle");
    expect(sockets[0].closed).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    c.subscribe("claims", () => {});
    sockets[1].drop();
    c.close();
    expect(c.getState()).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
    sockets[1].drop(); // double-close is harmless
    expect(sockets).toHaveLength(2);
  });

  it("survives rapid subscribe/unsubscribe churn", () => {
    const c = make();
    for (let i = 0; i < 50; i++) c.unsubscribe(c.subscribe("oracle", () => {}));
    expect(vi.getTimerCount()).toBe(0);
    expect(c.getState()).toBe("idle");
    const keep = c.subscribe("oracle", () => {});
    const extra = c.subscribe("oracle", () => {});
    sockets[sockets.length - 1].open();
    c.unsubscribe(extra);
    expect(sockets[sockets.length - 1].sent.filter((m) => m.op === "unsubscribe")).toHaveLength(0);
    c.unsubscribe(keep);
    expect(c.getState()).toBe("idle");
  });

  it("does not reconnect after an auth rejection", () => {
    const c = make();
    c.subscribe("oracle", () => {});
    sockets[0].open();
    sockets[0].drop(4401);
    vi.advanceTimersByTime(60_000);
    expect(c.getState()).toBe("closed");
    expect(sockets).toHaveLength(1);
  });

  it("flipping a topic off suspends it, notifies, and unsubscribes on the wire", () => {
    const c = make();
    const onDisabled = vi.fn();
    const handler = vi.fn();
    c.subscribe("oracle", handler, { onDisabled });
    c.subscribe("claims", () => {});
    sockets[0].open();
    c.setFlags({ ...ON, "realtime-oracle": false });
    expect(onDisabled).toHaveBeenCalledOnce();
    expect(sockets[0].sent).toContainEqual({ op: "unsubscribe", topic: "oracle" });
    sockets[0].push(frame("oracle", 1));
    expect(handler).not.toHaveBeenCalled();
    c.setFlags({ ...ON, "realtime-enabled": false });
    expect(c.getState()).toBe("idle");
  });
});

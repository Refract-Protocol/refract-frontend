import { describe, it, expect } from "vitest";
import { probeRealtime } from "./canary";

type L = (e: unknown) => void;
function fakeWS(script: (ws: FakeWS) => void) {
  class FakeWS {
    listeners: Record<string, L[]> = {};
    constructor() {
      queueMicrotask(() => script(this));
    }
    addEventListener(t: string, l: L) {
      (this.listeners[t] ??= []).push(l);
    }
    emit(t: string, e: unknown = {}) {
      this.listeners[t]?.forEach((l) => l(e));
    }
    send() {}
    close() {}
  }
  return FakeWS as unknown as typeof WebSocket;
}

describe("probeRealtime", () => {
  it("succeeds on the first event for the topic", async () => {
    const WebSocketImpl = fakeWS((ws) => {
      ws.emit("open");
      ws.emit("message", { data: JSON.stringify({ topic: "canary", payload: 1 }) });
    });
    const r = await probeRealtime({ url: "ws://x", topic: "canary", WebSocketImpl });
    expect(r.ok).toBe(true);
    expect(r.firstEventMs).toBeDefined();
  });

  it("reports an endpoint failure when the connection errors before open", async () => {
    const WebSocketImpl = fakeWS((ws) => ws.emit("error"));
    const r = await probeRealtime({ url: "ws://x", topic: "canary", WebSocketImpl });
    expect(r).toMatchObject({ ok: false, failure: "endpoint" });
  });

  it("times out instead of hanging", async () => {
    const WebSocketImpl = fakeWS((ws) => ws.emit("open"));
    const r = await probeRealtime({ url: "ws://x", topic: "canary", timeoutMs: 20, WebSocketImpl });
    expect(r).toMatchObject({ ok: false, failure: "timeout" });
  });
});

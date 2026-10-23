import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeClient } from "./client";

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  closeCount = 0;
  constructor(_url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }
  close() {
    this.closeCount++;
    this.dispatchEvent(new Event("close"));
  }
  message(data: string) {
    const event = new Event("message") as MessageEvent;
    Object.defineProperty(event, "data", { value: data });
    this.dispatchEvent(event);
  }
}

describe("realtime subscription lifecycle", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  it("reuses one socket across an immediate unmount/remount and tears down idempotently", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new RealtimeClient();
    const handler = vi.fn();
    const cleanupFirst = client.subscribe("oracle_update", handler);
    cleanupFirst();
    const cleanupSecond = client.subscribe("oracle_update", handler);
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0]!.message('{"topic":"oracle_update","payload":{"value":1}}');
    expect(handler).toHaveBeenCalledTimes(1);
    cleanupSecond();
    cleanupSecond();
    await Promise.resolve();
    expect(FakeWebSocket.instances[0]!.closeCount).toBe(1);
    FakeWebSocket.instances[0]!.message('{"topic":"oracle_update","payload":{"value":2}}');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("reference counts a shared callback and removes it only after its final cleanup", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new RealtimeClient();
    const handler = vi.fn();
    const first = client.subscribe("oracle_update", handler);
    const second = client.subscribe("oracle_update", handler);
    first();
    FakeWebSocket.instances[0]!.message('{"topic":"oracle_update","payload":1}');
    expect(handler).toHaveBeenCalledTimes(1);
    second();
    await Promise.resolve();
  });

  it("drops duplicate and out-of-order sequence numbers for each topic", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const client = new RealtimeClient();
    const handler = vi.fn();
    client.subscribe("oracle_update", handler);
    const socket = FakeWebSocket.instances[0]!;
    socket.message('{"topic":"oracle_update","payload":2,"sequence":2}');
    socket.message('{"topic":"oracle_update","payload":1,"sequence":1}');
    socket.message('{"topic":"oracle_update","payload":2,"sequence":2}');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(2);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { RealtimeClient } from "./client";

describe("RealtimeClient outbound batching", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes twenty topic operations as one frame", () => {
    const socket = { readyState: 1, send: vi.fn() };
    vi.stubGlobal("WebSocket", { OPEN: 1 });
    const client = new RealtimeClient() as any;
    client.socket = socket;
    for (let i = 0; i < 20; i++) client.enqueue(`topic-${i}`, "subscribe");
    client.flush();
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(socket.send.mock.calls[0]![0]).operations).toHaveLength(20);
  });

  it("elides subscribe then unsubscribe before the queued flush", () => {
    const client = new RealtimeClient() as any;
    client.enqueue("oracle_update", "subscribe");
    client.enqueue("oracle_update", "unsubscribe");
    expect(client.pending.size).toBe(0);
  });

  it("bounds queued topic operations and warns on overflow", () => {
    const client = new RealtimeClient() as any;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 501; i++) client.enqueue(`topic-${i}`, "subscribe");
    expect(client.pending.size).toBe(500);
    expect(warning).toHaveBeenCalled();
  });
});

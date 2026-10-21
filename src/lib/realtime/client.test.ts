import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { RealtimeClient } from "./client";
import { fakeRealtimeClock } from "./testClock";
import { createMockRealtimeServer } from "@/mocks/realtimeServer";

describe("RealtimeClient lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("warms once, then an unused connection closes at the idle deadline", async () => {
    const server = createMockRealtimeServer();
    const client = new RealtimeClient({
      clock: fakeRealtimeClock,
      socketFactory: server.socketFactory,
      idleTimeoutMs: 2_000,
    });
    client.warm();
    expect(server.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(server.sockets[0].closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.sockets[0].closed).toBe(true);
  });

  it("delivers the first event immediately after a warm subscribe and pays the handshake when cold", async () => {
    const warmServer = createMockRealtimeServer(100);
    const warmClient = new RealtimeClient({
      clock: fakeRealtimeClock,
      socketFactory: warmServer.socketFactory,
    });
    warmClient.warm();
    await vi.advanceTimersByTimeAsync(100);
    const warmHandler = vi.fn();
    const warmSubscribeAt = Date.now();
    warmClient.subscribe("oracle_update", warmHandler);
    warmServer.message(warmServer.sockets[0], "oracle_update", { ready: true });
    expect(warmHandler).toHaveBeenCalledTimes(1);
    expect(Date.now() - warmSubscribeAt).toBe(0);
    warmClient.disconnect();

    const coldServer = createMockRealtimeServer(100);
    const coldClient = new RealtimeClient({
      clock: fakeRealtimeClock,
      socketFactory: coldServer.socketFactory,
    });
    const coldHandler = vi.fn();
    const coldSubscribeAt = Date.now();
    coldClient.subscribe("oracle_update", coldHandler);
    await vi.advanceTimersByTimeAsync(100);
    coldServer.message(coldServer.sockets[0], "oracle_update", { ready: true });
    expect(coldHandler).toHaveBeenCalledTimes(1);
    expect(Date.now() - coldSubscribeAt).toBe(100);
    coldClient.disconnect();
  });

  it("does no socket work while the app shell renders on the server", () => {
    vi.unstubAllGlobals();
    const socketFactory = vi.fn();
    const client = new RealtimeClient({ socketFactory });
    function ServerShell() {
      client.warm();
      return createElement("main", null, "server content");
    }
    expect(renderToString(createElement(ServerShell))).toContain("server content");
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it("uses deterministic exponential backoff and honors a later maintenance deadline", async () => {
    const server = createMockRealtimeServer();
    const client = new RealtimeClient({
      clock: fakeRealtimeClock,
      socketFactory: server.socketFactory,
    });
    client.subscribe("oracle_update", () => {});
    await vi.advanceTimersByTimeAsync(0);
    const first = server.sockets[0];
    server.control(first, { type: "maintenance", until: Date.now() + 1_500 });
    first.close();
    await vi.advanceTimersByTimeAsync(1_499);
    expect(server.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(server.sockets).toHaveLength(2);
    client.disconnect();
  });

  it("sends clock-controlled heartbeats and clears the timeout on pong", async () => {
    const server = createMockRealtimeServer();
    const client = new RealtimeClient({
      clock: fakeRealtimeClock,
      socketFactory: server.socketFactory,
      heartbeatIntervalMs: 1_000,
      heartbeatTimeoutMs: 500,
    });
    client.subscribe("oracle_update", () => {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(JSON.parse(server.sockets[0].sent[0])).toEqual({
      topic: "$control",
      payload: { type: "ping" },
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(server.sockets[0].closed).toBe(false);
    client.disconnect();
  });

  it("removes revoked subscriptions, reports the reason, and never forwards controls", async () => {
    const server = createMockRealtimeServer();
    const client = new RealtimeClient({
      clock: fakeRealtimeClock,
      socketFactory: server.socketFactory,
    });
    const domain = vi.fn();
    const control = vi.fn();
    const unsubscribe = client.subscribe("oracle_update", domain);
    client.subscribeControl(control);
    await vi.advanceTimersByTimeAsync(0);
    const socket = server.sockets[0];
    server.control(socket, {
      type: "revocation",
      topic: "oracle_update",
      reason: "Access expired",
    });
    server.control(socket, {
      type: "revocation",
      topic: "oracle_update",
      reason: "Access expired",
    });
    server.message(socket, "oracle_update", { value: 5 });
    expect(domain).not.toHaveBeenCalled();
    expect(control).toHaveBeenCalledWith({
      type: "revocation",
      topic: "oracle_update",
      reason: "Access expired",
    });
    expect(control).toHaveBeenCalledTimes(1);
    unsubscribe();
    client.disconnect();
  });

  it("reconnects immediately when the server signals drain complete", async () => {
    const server = createMockRealtimeServer();
    const client = new RealtimeClient({
      clock: fakeRealtimeClock,
      socketFactory: server.socketFactory,
    });
    client.subscribe("oracle_update", () => {});
    await vi.advanceTimersByTimeAsync(0);
    server.control(server.sockets[0], { type: "drain", until: Date.now() + 60_000 });
    server.control(server.sockets[0], { type: "drain-complete" });
    expect(server.sockets).toHaveLength(2);
    client.disconnect();
  });
});

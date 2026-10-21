import { afterEach, describe, expect, it, vi } from "vitest";
import { realtimeClient } from "./client";
import { ApiError } from "@/lib/api/client";

class MockSocket {
  static OPEN = 1;
  readyState = 0;
  url: string;
  sent: string[] = [];
  listeners = new Map<string, Array<(event: any) => void>>();
  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code = 1000) {
    this.readyState = 3;
    this.emit("close", { code });
  }
  emit(type: string, event: any = {}) {
    if (type === "open") this.readyState = 1;
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

let sockets: MockSocket[] = [];
const originalWebSocket = globalThis.WebSocket;

describe("authenticated realtime client", () => {
  afterEach(() => {
    realtimeClient.disconnect();
    realtimeClient.setIdentity(null);
    vi.useRealTimers();
    sockets = [];
    globalThis.WebSocket = originalWebSocket;
  });

  it("sends credentials only in the handshake and subscribes after authentication", async () => {
    sockets = [];
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    realtimeClient.setTokenProvider(async () => ({
      token: "secret-token",
      expiresAt: Date.now() + 60_000,
    }));
    realtimeClient.setIdentity("G-WALLET");
    const handler = vi.fn();
    const unsubscribe = realtimeClient.subscribe("notifications", handler, { authenticated: true });
    await Promise.resolve();
    const socket = sockets[0]!;
    socket.emit("open");
    const authFrame = JSON.parse(socket.sent[0]!);
    expect(authFrame).toMatchObject({
      type: "authenticate",
      wallet: "G-WALLET",
      token: "secret-token",
    });
    expect(socket.url).not.toContain("secret-token");
    socket.emit("message", { data: JSON.stringify({ type: "authenticated" }) });
    expect(socket.sent.map((frame) => JSON.parse(frame).topic).filter(Boolean)).toEqual([
      "notifications",
    ]);
    socket.emit("message", {
      data: JSON.stringify({ topic: "notifications", payload: { id: "n1" } }),
    });
    expect(handler).toHaveBeenCalledWith({ id: "n1" });
    unsubscribe();
  });

  it("refreshes before expiry without resubscribing", async () => {
    vi.useFakeTimers();
    sockets = [];
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    const provider = vi.fn(async () => ({
      token: `token-${provider.mock.calls.length}`,
      expiresAt: Date.now() + 35_000,
    }));
    realtimeClient.setTokenProvider(provider);
    realtimeClient.setIdentity("G-WALLET");
    const unsubscribe = realtimeClient.subscribe("notifications", vi.fn(), { authenticated: true });
    await Promise.resolve();
    const socket = sockets[0]!;
    socket.emit("open");
    socket.emit("message", { data: JSON.stringify({ type: "authenticated" }) });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(socket.sent.filter((frame) => JSON.parse(frame).type === "authenticate")).toHaveLength(
      2
    );
    expect(socket.sent.filter((frame) => JSON.parse(frame).type === "subscribe")).toHaveLength(1);
    unsubscribe();
  });

  it("reauthenticates and restores a topic exactly once after reconnect", async () => {
    vi.useFakeTimers();
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    realtimeClient.setTokenProvider(async () => ({
      token: "fresh",
      expiresAt: Date.now() + 60_000,
    }));
    realtimeClient.setIdentity("G-WALLET");
    const unsubscribe = realtimeClient.subscribe("notifications", vi.fn(), { authenticated: true });
    await Promise.resolve();
    const first = sockets[0]!;
    first.emit("open");
    first.emit("message", { data: JSON.stringify({ type: "authenticated" }) });
    first.close(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    const second = sockets[1]!;
    second.emit("open");
    second.emit("message", { data: JSON.stringify({ type: "authenticated" }) });
    expect(second.sent.filter((frame) => JSON.parse(frame).type === "authenticate")).toHaveLength(
      1
    );
    expect(second.sent.filter((frame) => JSON.parse(frame).type === "subscribe")).toHaveLength(1);
    unsubscribe();
  });

  it("marks auth failures as terminal without retrying", async () => {
    vi.useFakeTimers();
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    const states: string[] = [];
    realtimeClient.setTokenProvider(async () => {
      throw new ApiError("denied", 403);
    });
    realtimeClient.setIdentity("G-WALLET");
    const unsubscribePrivate = realtimeClient.subscribe("notifications", vi.fn(), {
      authenticated: true,
      onState: (state) => states.push(state),
    });
    const unsubscribePublic = realtimeClient.subscribe("claims.settlement", vi.fn());
    await Promise.resolve();
    expect(states).toContain("auth_failed");
    sockets[0]!.emit("open");
    expect(sockets[0]!.sent.some((frame) => JSON.parse(frame).topic === "claims.settlement")).toBe(
      true
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
    unsubscribePrivate();
    unsubscribePublic();
  });

  it("discards a stale token request when the account changes", async () => {
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    let releaseOld!: (value: { token: string; expiresAt: number }) => void;
    realtimeClient.setTokenProvider((wallet) =>
      wallet === "G-OLD"
        ? new Promise((resolve) => {
            releaseOld = resolve;
          })
        : Promise.resolve({ token: "new-wallet-token", expiresAt: Date.now() + 60_000 })
    );
    realtimeClient.setIdentity("G-OLD");
    const unsubscribe = realtimeClient.subscribe("notifications", vi.fn(), { authenticated: true });
    realtimeClient.setIdentity("G-NEW");
    releaseOld({ token: "old-wallet-token", expiresAt: Date.now() + 60_000 });
    await Promise.resolve();
    await Promise.resolve();
    expect(sockets).toHaveLength(1);
    sockets[0]!.emit("open");
    expect(JSON.parse(sockets[0]!.sent[0]!).wallet).toBe("G-NEW");
    expect(sockets[0]!.sent[0]).not.toContain("old-wallet-token");
    unsubscribe();
  });

  it("keeps public topics alive after an authenticated topic is denied", async () => {
    vi.useFakeTimers();
    globalThis.WebSocket = MockSocket as unknown as typeof WebSocket;
    const provider = vi.fn(async () => ({
      token: "private-token",
      expiresAt: Date.now() + 60_000,
    }));
    realtimeClient.setTokenProvider(provider);
    realtimeClient.setIdentity("G-WALLET");
    const unsubscribePrivate = realtimeClient.subscribe("notifications", vi.fn(), {
      authenticated: true,
    });
    const unsubscribePublic = realtimeClient.subscribe("claims.settlement", vi.fn());
    await Promise.resolve();
    sockets[0]!.emit("open");
    sockets[0]!.emit("message", { data: JSON.stringify({ type: "auth_error", status: 403 }) });
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    sockets[1]!.emit("open");
    expect(provider).toHaveBeenCalledOnce();
    expect(sockets[1]!.sent.map((frame) => JSON.parse(frame).topic).filter(Boolean)).toEqual([
      "claims.settlement",
    ]);
    unsubscribePrivate();
    unsubscribePublic();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeClient, type ClientIntrospection } from "./client";
import { fakeSocketFactory } from "./testing/fakeSocket";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function makeClient(opts: { maxAttempts?: number; scopeDebounceMs?: number } = {}) {
  const sockets = fakeSocketFactory();
  const client = new RealtimeClient({
    createSocket: sockets.create,
    url: () => "ws://test/ws",
    scopeDebounceMs: opts.scopeDebounceMs ?? 50,
    maxAttempts: opts.maxAttempts ?? 3,
  });
  client.setEnabled(true);
  return { client, sockets };
}

function snap(client: RealtimeClient): ClientIntrospection {
  const s = client.introspect();
  if (!s) throw new Error("introspect() returned null — is NODE_ENV 'production'?");
  return s;
}

describe("RealtimeClient leak detection", () => {
  describe("subscribe / unsubscribe balance", () => {
    it("reaches zero after a single handler unsubscribes", () => {
      const { client } = makeClient();
      const unsub = client.subscribe("oracle_update", () => {});

      expect(snap(client).activeTopicCount).toBe(1);
      expect(snap(client).handlerCounts["oracle_update"]).toBe(1);

      unsub();

      expect(snap(client).activeTopicCount).toBe(0);
      expect(snap(client).handlerCounts["oracle_update"]).toBeUndefined();
    });

    it("reaches zero across multiple topics", () => {
      const { client } = makeClient();
      const u1 = client.subscribe("oracle_update", () => {});
      const u2 = client.subscribe("claim_settled", () => {});

      expect(snap(client).activeTopicCount).toBe(2);

      u1();
      u2();

      expect(snap(client).activeTopicCount).toBe(0);
    });

    it("reference-counts handlers on the same topic", () => {
      const { client } = makeClient();
      const u1 = client.subscribe("oracle_update", () => {});
      client.subscribe("oracle_update", () => {});

      expect(snap(client).handlerCounts["oracle_update"]).toBe(2);

      u1();
      expect(snap(client).handlerCounts["oracle_update"]).toBe(1);

      // Last handler
      const remaining = snap(client).handlerCounts["oracle_update"];
      expect(remaining).toBe(1);
    });

    it("sends an unsubscribe message when the last handler leaves", () => {
      const { client, sockets } = makeClient();
      const unsub = client.subscribe("oracle_update", () => {});
      sockets.latest()!.serverOpen();

      unsub();

      expect(sockets.latest()!.sent).toContainEqual({
        type: "unsubscribe",
        topic: "oracle_update",
      });
    });
  });

  describe("socket lifecycle", () => {
    it("closes the socket on disconnect", () => {
      const { client, sockets } = makeClient();
      client.subscribe("oracle_update", () => {});
      const socket = sockets.latest()!;
      socket.serverOpen();

      expect(snap(client).hasSocket).toBe(true);

      client.disconnect();

      expect(snap(client).hasSocket).toBe(false);
      expect(socket.closed).toBe(true);
    });

    it("closes the socket on setEnabled(false)", () => {
      const { client, sockets } = makeClient();
      client.subscribe("oracle_update", () => {});
      const socket = sockets.latest()!;
      socket.serverOpen();

      client.setEnabled(false);

      expect(snap(client).hasSocket).toBe(false);
      expect(socket.closed).toBe(true);
    });
  });

  describe("timer cleanup", () => {
    it("clears the reconnect timer on disconnect", () => {
      const { client, sockets } = makeClient();
      client.subscribe("oracle_update", () => {});
      const socket = sockets.latest()!;
      socket.serverOpen();

      // Drop the connection to arm the reconnect timer.
      socket.serverDrop(1006);
      expect(snap(client).hasReconnectTimer).toBe(true);

      client.disconnect();
      expect(snap(client).hasReconnectTimer).toBe(false);
    });

    it("clears the scope timer on disconnect (no leaked scope timer)", () => {
      const { client } = makeClient({ scopeDebounceMs: 100 });
      client.subscribe("oracle_update", () => {});

      // Arm the scope debounce timer.
      client.setScope({ network: "mainnet", account: null });
      expect(snap(client).hasScopeTimer).toBe(true);

      // Disconnect before the debounce fires.
      client.disconnect();
      expect(snap(client).hasScopeTimer).toBe(false);
      expect(snap(client).hasReconnectTimer).toBe(false);
    });

    it("clears both reconnect and scope timers on teardown", () => {
      const { client, sockets } = makeClient({ scopeDebounceMs: 100 });
      client.subscribe("oracle_update", () => {});
      sockets.latest()!.serverOpen();
      sockets.latest()!.serverDrop(1006);

      client.setScope({ network: "mainnet", account: null });

      expect(snap(client).hasReconnectTimer).toBe(true);
      expect(snap(client).hasScopeTimer).toBe(true);

      client.disconnect();

      expect(snap(client).hasReconnectTimer).toBe(false);
      expect(snap(client).hasScopeTimer).toBe(false);
    });
  });

  describe("scope listener cleanup", () => {
    it("removes scope listeners when their unsubscribe is called", () => {
      const { client } = makeClient();
      const remove = client.onScopeChange(() => {});

      expect(snap(client).scopeListenerCount).toBe(1);

      remove();
      expect(snap(client).scopeListenerCount).toBe(0);
    });

    it("does not accumulate listeners across cycles", () => {
      const { client } = makeClient();
      for (let i = 0; i < 10; i += 1) {
        const remove = client.onScopeChange(() => {});
        remove();
      }
      expect(snap(client).scopeListenerCount).toBe(0);
    });
  });

  describe("guard: connection does not retain references to closed scopes", () => {
    it("clears per-topic stores and updates scope after a scope change", () => {
      const { client, sockets } = makeClient({ scopeDebounceMs: 50 });
      client.subscribe("oracle_update", () => {});
      const socket = sockets.latest()!;
      socket.serverOpen();

      // Populate per-topic stores under the old scope.
      socket.serverSend({ topic: "oracle_update", payload: { price: 1 } });
      expect(snap(client).bufferCount).toBeGreaterThan(0);
      expect(snap(client).lastFrameCount).toBeGreaterThan(0);

      // Trigger a scope change.
      client.setScope({ network: "mainnet", account: null });
      vi.advanceTimersByTime(50);

      const after = snap(client);
      expect(after.scope.network).toBe("mainnet");
      expect(after.epoch).toBe(1);
      // Old socket is torn down; a new one is opened for the new scope.
      expect(sockets.sockets.length).toBe(2);
      expect(after.bufferCount).toBe(0);
      expect(after.lastFrameCount).toBe(0);
      expect(after.topicStateCount).toBe(0);
    });

    it("does not deliver stale frames from a previous scope after the change", () => {
      const { client, sockets } = makeClient({ scopeDebounceMs: 50 });
      const handler = vi.fn();
      client.subscribe("oracle_update", handler);
      const socket = sockets.latest()!;
      socket.serverOpen();

      // Frame under old scope (epoch 0).
      socket.serverSend({ topic: "oracle_update", payload: { price: 1 } });
      expect(handler).toHaveBeenCalledTimes(1);

      // Change scope.
      client.setScope({ network: "mainnet", account: null });
      vi.advanceTimersByTime(50);

      const newSocket = sockets.latest()!;
      newSocket.serverOpen();

      // Re-send the same frame under the new scope (epoch 1).
      newSocket.serverSend({ topic: "oracle_update", payload: { price: 2 } });
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenLastCalledWith(
        { price: 2 },
        expect.objectContaining({ epoch: 1 }),
      );
    });
  });

  describe("full session lifecycle", () => {
    it("leaves no handlers, timers, sockets, or listeners after subscribe → unsubscribe → disconnect", () => {
      const { client, sockets } = makeClient();
      const unsub = client.subscribe("oracle_update", () => {});
      const removeListener = client.onScopeChange(() => {});
      sockets.latest()!.serverOpen();
      sockets.latest()!.serverSend({ topic: "oracle_update", payload: { price: 1 } });

      unsub();
      removeListener();
      client.disconnect();

      const s = snap(client);
      expect(s.activeTopicCount).toBe(0);
      expect(s.hasSocket).toBe(false);
      expect(s.hasReconnectTimer).toBe(false);
      expect(s.hasScopeTimer).toBe(false);
      expect(s.scopeListenerCount).toBe(0);
      expect(s.handlerCounts).toEqual({});
    });
  });
});

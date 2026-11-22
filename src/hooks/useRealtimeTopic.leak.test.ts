import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import {
  RealtimeClient,
  realtimeClient,
  type ClientIntrospection,
} from "@/lib/realtime/client";
import { fakeSocketFactory } from "@/lib/realtime/testing/fakeSocket";
import { useRealtimeTopic, useRealtimeRevision } from "./useRealtimeTopic";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  // Reset the singleton so tests don't leak state into each other.
  realtimeClient.disconnect();
});

function makeClient() {
  const sockets = fakeSocketFactory();
  const client = new RealtimeClient({
    createSocket: sockets.create,
    url: () => "ws://test/ws",
    scopeDebounceMs: 50,
  });
  client.setEnabled(true);
  return { client, sockets };
}

function snap(client: RealtimeClient): ClientIntrospection {
  const s = client.introspect();
  if (!s) throw new Error("introspect() returned null");
  return s;
}

describe("useRealtimeTopic leak detection", () => {
  describe("unmount teardown", () => {
    it("reduces handler count to zero on unmount", () => {
      const { client } = makeClient();
      const { unmount } = renderHook(() =>
        useRealtimeTopic<{ price: number }>("oracle_update", { client }),
      );

      expect(snap(client).handlerCounts["oracle_update"]).toBe(1);

      unmount();

      expect(snap(client).activeTopicCount).toBe(0);
      expect(snap(client).handlerCounts["oracle_update"]).toBeUndefined();
    });

    it("sends an unsubscribe message when the last consumer unmounts", () => {
      const { client, sockets } = makeClient();
      const { unmount } = renderHook(() =>
        useRealtimeTopic("oracle_update", { client }),
      );
      sockets.latest()!.serverOpen();

      unmount();

      expect(sockets.latest()!.sent).toContainEqual({
        type: "unsubscribe",
        topic: "oracle_update",
      });
    });

    it("cleans up every topic when multiple hooks unmount", () => {
      const { client } = makeClient();
      const a = renderHook(() => useRealtimeTopic("oracle_update", { client }));
      const b = renderHook(() => useRealtimeTopic("claim_settled", { client }));

      expect(snap(client).activeTopicCount).toBe(2);

      a.unmount();
      b.unmount();

      expect(snap(client).activeTopicCount).toBe(0);
    });
  });

  describe("route change (topic swap)", () => {
    it("tears down the old topic and subscribes to the new one", () => {
      const { client } = makeClient();
      let topic = "oracle_update";
      const { rerender, unmount } = renderHook(() =>
        useRealtimeTopic<{ price: number }>(topic, { client }),
      );

      expect(snap(client).handlerCounts["oracle_update"]).toBe(1);

      // Simulate navigating to a different route that subscribes to a different topic.
      topic = "claim_settled";
      rerender();

      expect(snap(client).handlerCounts["oracle_update"]).toBeUndefined();
      expect(snap(client).handlerCounts["claim_settled"]).toBe(1);

      unmount();
      expect(snap(client).activeTopicCount).toBe(0);
    });
  });

  describe("React StrictMode double-mount", () => {
    it("does not leak a duplicate handler after the double-mount cycle", () => {
      const { client } = makeClient();
      const { unmount } = renderHook(
        () => useRealtimeTopic<{ price: number }>("oracle_update", { client }),
        {
          wrapper: ({ children }) =>
            React.createElement(React.StrictMode, null, children),
        },
      );

      // After StrictMode mount → cleanup → mount, the handler count must be 1, not 2.
      expect(snap(client).handlerCounts["oracle_update"]).toBe(1);

      unmount();
      expect(snap(client).activeTopicCount).toBe(0);
    });

    it("does not open a second socket after StrictMode double-mount", () => {
      const { client, sockets } = makeClient();
      const { unmount } = renderHook(
        () => useRealtimeTopic("oracle_update", { client }),
        {
          wrapper: ({ children }) =>
            React.createElement(React.StrictMode, null, children),
        },
      );

      // Only one socket should have been created.
      expect(sockets.sockets.length).toBe(1);

      unmount();
    });

    it("cleans up correctly after StrictMode double-mount → unmount", () => {
      const { client } = makeClient();
      const { unmount } = renderHook(
        () => useRealtimeTopic("oracle_update", { client }),
        {
          wrapper: ({ children }) =>
            React.createElement(React.StrictMode, null, children),
        },
      );

      unmount();

      const s = snap(client);
      expect(s.activeTopicCount).toBe(0);
      expect(s.handlerCounts["oracle_update"]).toBeUndefined();
    });
  });

  describe("client close", () => {
    it("closes the socket when the client disconnects while a hook is mounted", () => {
      const { client, sockets } = makeClient();
      renderHook(() => useRealtimeTopic("oracle_update", { client }));
      const socket = sockets.latest()!;
      socket.serverOpen();

      expect(snap(client).hasSocket).toBe(true);

      client.disconnect();

      expect(snap(client).hasSocket).toBe(false);
      expect(socket.closed).toBe(true);
    });

    it("clears all timers on disconnect while mounted", () => {
      const { client, sockets } = makeClient();
      renderHook(() => useRealtimeTopic("oracle_update", { client }));
      sockets.latest()!.serverOpen();
      sockets.latest()!.serverDrop(1006);

      expect(snap(client).hasReconnectTimer).toBe(true);

      client.disconnect();

      expect(snap(client).hasReconnectTimer).toBe(false);
      expect(snap(client).hasScopeTimer).toBe(false);
    });
  });

  describe("useRealtimeRevision timer cleanup", () => {
    it("clears the debounce timer on unmount", () => {
      // Prevent the singleton from opening a real WebSocket in jsdom.
      realtimeClient.setEnabled(false);

      const { unmount } = renderHook(() =>
        useRealtimeRevision("oracle_update", null),
      );

      // Arm the debounce timer by publishing a frame directly.
      act(() => realtimeClient.publish("oracle_update", { value: 1 }, "test"));
      const timersBefore = vi.getTimerCount();

      // Unmount — the cleanup effect should clear the pending timer.
      unmount();
      const timersAfter = vi.getTimerCount();

      expect(timersAfter).toBeLessThan(timersBefore);

      // Advancing past the debounce window should not fire the callback
      // (which would prove the timer was cleared, not just deferred).
      vi.advanceTimersByTime(500);
      expect(vi.getTimerCount()).toBe(timersAfter);
    });
  });
});

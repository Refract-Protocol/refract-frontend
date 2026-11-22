import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { RealtimeClient } from "./client";
import { fakeSocketFactory } from "./testing/fakeSocket";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function makeClient(opts: { threshold?: number; probeMs?: number; enabled?: boolean } = {}) {
  const sockets = fakeSocketFactory();
  const client = new RealtimeClient({
    createSocket: sockets.create,
    url: () => "ws://test/ws",
    baseBackoffMs: 100,
    maxBackoffMs: 500,
    maxAttempts: 10,
    circuitBreaker: {
      failureThreshold: opts.threshold ?? 3,
      probeIntervalMs: opts.probeMs ?? 1000,
      enabled: opts.enabled ?? true,
    },
  });
  client.setEnabled(true);
  return { client, sockets };
}

/** Drop the latest socket without ever opening it (counts as a failure). */
function dropLatest(sockets: ReturnType<typeof fakeSocketFactory>) {
  const socket = sockets.latest();
  socket.serverDrop(1006);
}

describe("Circuit breaker integration with RealtimeClient", () => {
  describe("tripping after consecutive failures", () => {
    it("trips OPEN after the threshold of consecutive socket drops", () => {
      const { client, sockets } = makeClient({ threshold: 3 });
      client.subscribe("oracle_update", () => {});

      // Three consecutive drops without a successful open.
      for (let i = 0; i < 3; i++) {
        dropLatest(sockets);
        // Flush the reconnect timer to open the next socket.
        vi.advanceTimersByTime(500);
      }

      expect(client.getCircuitState()).toBe("open");
      expect(client.isCircuitOpen()).toBe(true);
    });

    it("does not trip if a connection succeeds between failures", () => {
      const { client, sockets } = makeClient({ threshold: 3 });
      client.subscribe("oracle_update", () => {});

      // Drop, reconnect, open (success), drop, reconnect, open (success)...
      for (let i = 0; i < 5; i++) {
        dropLatest(sockets);
        vi.advanceTimersByTime(500);
        sockets.latest().serverOpen();
      }

      expect(client.getCircuitState()).toBe("closed");
    });
  });

  describe("blocking transport while OPEN", () => {
    it("does not open a new socket while the breaker is OPEN", () => {
      const { client, sockets } = makeClient({ threshold: 3 });
      client.subscribe("oracle_update", () => {});
      const socketsBefore = sockets.sockets.length;

      for (let i = 0; i < 3; i++) {
        dropLatest(sockets);
        vi.advanceTimersByTime(500);
      }

      expect(client.getCircuitState()).toBe("open");
      // No new sockets created after the breaker tripped.
      expect(sockets.sockets.length).toBe(socketsBefore);

      // Advancing time past reconnect delays should not create sockets.
      vi.advanceTimersByTime(10_000);
      expect(sockets.sockets.length).toBe(socketsBefore);
    });

    it("sets health to unavailable while OPEN", () => {
      const { client, sockets } = makeClient({ threshold: 3 });
      client.subscribe("oracle_update", () => {});

      for (let i = 0; i < 3; i++) {
        dropLatest(sockets);
        vi.advanceTimersByTime(500);
      }

      expect(client.health.get()).toBe("unavailable");
    });

    it("stops reconnect churn while OPEN", () => {
      const { client, sockets } = makeClient({ threshold: 3 });
      client.subscribe("oracle_update", () => {});

      for (let i = 0; i < 3; i++) {
        dropLatest(sockets);
        vi.advanceTimersByTime(500);
      }

      const introspect = client.introspect();
      expect(introspect).not.toBeNull();
      expect(introspect!.hasReconnectTimer).toBe(false);
      expect(introspect!.circuitState).toBe("open");
    });
  });

  describe("half-open probe and recovery", () => {
    it("transitions to HALF_OPEN after the probe interval and opens a probe socket", () => {
      const { client, sockets } = makeClient({ threshold: 2, probeMs: 1000 });
      client.subscribe("oracle_update", () => {});

      // Trip the breaker.
      dropLatest(sockets);
      vi.advanceTimersByTime(500);
      dropLatest(sockets);
      vi.advanceTimersByTime(500);
      expect(client.getCircuitState()).toBe("open");

      const socketsBefore = sockets.sockets.length;

      // Advance past the probe interval.
      vi.advanceTimersByTime(1000);

      expect(client.getCircuitState()).toBe("half-open");
      // onHalfOpen triggered open(), which created a new socket.
      expect(sockets.sockets.length).toBe(socketsBefore + 1);
    });

    it("closes on a successful probe", () => {
      const { client, sockets } = makeClient({ threshold: 2, probeMs: 1000 });
      client.subscribe("oracle_update", () => {});

      dropLatest(sockets);
      vi.advanceTimersByTime(500);
      dropLatest(sockets);
      vi.advanceTimersByTime(500);
      expect(client.getCircuitState()).toBe("open");

      vi.advanceTimersByTime(1000);
      expect(client.getCircuitState()).toBe("half-open");

      // Probe succeeds.
      sockets.latest().serverOpen();

      expect(client.getCircuitState()).toBe("closed");
      expect(client.health.get()).toBe("healthy");
    });

    it("reopens if the probe fails", () => {
      const { client, sockets } = makeClient({ threshold: 1, probeMs: 1000 });
      client.subscribe("oracle_update", () => {});

      dropLatest(sockets);
      vi.advanceTimersByTime(500);
      expect(client.getCircuitState()).toBe("open");

      vi.advanceTimersByTime(1000);
      expect(client.getCircuitState()).toBe("half-open");

      // Probe fails.
      dropLatest(sockets);

      expect(client.getCircuitState()).toBe("open");
    });

    it("schedules a new probe after a failed probe", () => {
      const { client, sockets } = makeClient({ threshold: 1, probeMs: 1000 });
      client.subscribe("oracle_update", () => {});

      dropLatest(sockets);
      vi.advanceTimersByTime(500);
      expect(client.getCircuitState()).toBe("open");

      vi.advanceTimersByTime(1000);
      expect(client.getCircuitState()).toBe("half-open");
      dropLatest(sockets);
      expect(client.getCircuitState()).toBe("open");

      vi.advanceTimersByTime(1000);
      expect(client.getCircuitState()).toBe("half-open");
    });
  });

  describe("disabled breaker never trips", () => {
    it("continues reconnecting when the breaker is disabled", () => {
      const { client, sockets } = makeClient({ threshold: 1, enabled: false });
      client.subscribe("oracle_update", () => {});

      for (let i = 0; i < 5; i++) {
        dropLatest(sockets);
        vi.advanceTimersByTime(500);
      }

      expect(client.getCircuitState()).toBe("closed");
      expect(client.isCircuitOpen()).toBe(false);
      // Sockets keep being created (normal reconnect behavior).
      expect(sockets.sockets.length).toBeGreaterThan(1);
    });
  });

  describe("onCircuitStateChange", () => {
    it("notifies listeners on state transitions", () => {
      const { client, sockets } = makeClient({ threshold: 1, probeMs: 1000 });
      const states: string[] = [];
      client.onCircuitStateChange((s) => states.push(s));

      client.subscribe("oracle_update", () => {});
      dropLatest(sockets);
      vi.advanceTimersByTime(500);

      expect(states).toContain("open");

      vi.advanceTimersByTime(1000);
      expect(states).toContain("half-open");

      sockets.latest().serverOpen();
      expect(states).toContain("closed");
    });
  });
});

// Hook tests must use `act()` because circuit state changes drive React state.
describe("useRealtimeTopic circuit breaker integration", () => {
  it("subscribes when the breaker is CLOSED and unsubscribes when it trips OPEN", async () => {
    const { useRealtimeTopic } = await import("@/hooks/useRealtimeTopic");
    const { client, sockets } = makeClient({ threshold: 3, probeMs: 1000 });

    const { unmount } = renderHook(() =>
      useRealtimeTopic<{ price: number }>("oracle_update", { client }),
    );

    // Hook is subscribed.
    expect(client.introspect()!.handlerCounts["oracle_update"]).toBe(1);

    // Trip the breaker with 3 consecutive drops.
    for (let i = 0; i < 3; i++) {
      act(() => {
        dropLatest(sockets);
      });
      act(() => vi.advanceTimersByTime(500));
    }

    // Breaker is open; hook should have unsubscribed (REST-only mode).
    expect(client.getCircuitState()).toBe("open");
    expect(client.introspect()!.activeTopicCount).toBe(0);

    unmount();
  });

  it("re-subscribes and receives data after the breaker recovers", async () => {
    const { useRealtimeTopic } = await import("@/hooks/useRealtimeTopic");
    const { client, sockets } = makeClient({ threshold: 2, probeMs: 1000 });

    let received: number | undefined;
    const { unmount } = renderHook(() =>
      useRealtimeTopic<{ price: number }>("oracle_update", {
        client,
        onEvent: (v) => {
          received = v.price;
        },
      }),
    );

    // Open socket and receive data while closed.
    act(() => sockets.latest().serverOpen());
    act(() => sockets.latest().serverSend({ topic: "oracle_update", payload: { price: 42 } }));
    expect(received).toBe(42);

    // Trip the breaker.
    act(() => dropLatest(sockets));
    act(() => vi.advanceTimersByTime(200));
    act(() => dropLatest(sockets));
    act(() => vi.advanceTimersByTime(200));
    expect(client.getCircuitState()).toBe("open");

    // While open, publishing a frame should not reach the hook
    // (the client won't have the handler — it unsubscribed).
    expect(client.introspect()!.activeTopicCount).toBe(0);

    // Probe: advance to half-open, which triggers open().
    act(() => vi.advanceTimersByTime(1000));
    expect(client.getCircuitState()).toBe("half-open");

    // Probe succeeds → breaker closes → hook re-subscribes.
    act(() => sockets.latest().serverOpen());
    expect(client.getCircuitState()).toBe("closed");
    expect(client.introspect()!.activeTopicCount).toBe(1);

    // Data flows again.
    act(() => sockets.latest().serverSend({ topic: "oracle_update", payload: { price: 99 } }));
    expect(received).toBe(99);

    unmount();
  });
});

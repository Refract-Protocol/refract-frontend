import { describe, expect, it, vi } from "vitest";
import {
  TopicSubscriptionRegistry,
  type TopicSubscriber,
  type UnderlyingTopicTransport,
} from "./registry";

function createFakeTransport() {
  const upstreamHandlers = new Map<string, Set<TopicSubscriber>>();
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  let disconnectCalls = 0;

  const transport: UnderlyingTopicTransport = {
    subscribe: (topic, handler) => {
      subscribeCalls += 1;
      if (!upstreamHandlers.has(topic)) {
        upstreamHandlers.set(topic, new Set());
      }
      upstreamHandlers.get(topic)!.add(handler);
      return () => {
        unsubscribeCalls += 1;
        upstreamHandlers.get(topic)?.delete(handler);
      };
    },
    disconnect: () => {
      disconnectCalls += 1;
    },
  };

  const emit = (topic: string, payload: unknown) => {
    upstreamHandlers.get(topic)?.forEach((h) => h(payload));
  };

  return {
    transport,
    emit,
    getStats: () => ({
      subscribeCalls,
      unsubscribeCalls,
      disconnectCalls,
      activeUpstreamCount: (topic: string) => upstreamHandlers.get(topic)?.size ?? 0,
    }),
  };
}

describe("TopicSubscriptionRegistry", () => {
  it("opens a single upstream subscription per topic and fans out events to all consumers", () => {
    const fake = createFakeTransport();
    const registry = new TopicSubscriptionRegistry({
      transport: fake.transport,
      teardownGraceMs: 0,
    });

    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];

    const unsubA = registry.subscribe("oracle.readings", (p) => receivedA.push(p));
    const unsubB = registry.subscribe("oracle.readings", (p) => receivedB.push(p));

    expect(fake.getStats().subscribeCalls).toBe(1);
    expect(registry.getRefCount("oracle.readings")).toBe(2);
    expect(registry.getSnapshot()).toEqual({
      activeTopics: [{ topic: "oracle.readings", refCount: 2, pendingTeardown: false }],
      totalSubscribers: 2,
    });

    fake.emit("oracle.readings", { value: 0.999 });
    expect(receivedA).toEqual([{ value: 0.999 }]);
    expect(receivedB).toEqual([{ value: 0.999 }]);

    // Unsubscribing first consumer decrements refCount without tearing down upstream
    unsubA();
    unsubA(); // idempotent double call
    expect(registry.getRefCount("oracle.readings")).toBe(1);
    expect(fake.getStats().unsubscribeCalls).toBe(0);
    expect(fake.getStats().disconnectCalls).toBe(0);

    // Unsubscribing last consumer tears down upstream and disconnects transport
    unsubB();
    expect(registry.getRefCount("oracle.readings")).toBe(0);
    expect(fake.getStats().unsubscribeCalls).toBe(1);
    expect(fake.getStats().disconnectCalls).toBe(1);
  });

  it("coalesces React 18 StrictMode unmount/remount cycles within the grace window", () => {
    vi.useFakeTimers();
    const fake = createFakeTransport();
    const registry = new TopicSubscriptionRegistry({
      transport: fake.transport,
      teardownGraceMs: 20,
    });

    // Initial mount
    const unsubMount1 = registry.subscribe("claims.settlement", () => {});
    expect(fake.getStats().subscribeCalls).toBe(1);

    // StrictMode simulated unmount
    unsubMount1();
    expect(registry.getSnapshot().activeTopics[0]).toEqual({
      topic: "claims.settlement",
      refCount: 0,
      pendingTeardown: true,
    });
    expect(fake.getStats().unsubscribeCalls).toBe(0);

    // StrictMode immediate remount before grace timer expires
    vi.advanceTimersByTime(5);
    const receivedMount2: unknown[] = [];
    const unsubMount2 = registry.subscribe("claims.settlement", (p) => receivedMount2.push(p));

    vi.advanceTimersByTime(30);
    // Still only 1 upstream subscribe and 0 upstream unsubscribes!
    expect(fake.getStats().subscribeCalls).toBe(1);
    expect(fake.getStats().unsubscribeCalls).toBe(0);

    fake.emit("claims.settlement", { policyId: "pol-1" });
    expect(receivedMount2).toEqual([{ policyId: "pol-1" }]);

    // Final unmount tears down after grace window expires
    unsubMount2();
    vi.advanceTimersByTime(25);
    expect(fake.getStats().unsubscribeCalls).toBe(1);
    expect(fake.getStats().disconnectCalls).toBe(1);
    vi.useRealTimers();
  });

  it("re-establishes active topic subscriptions on reconnect and notifies registry listeners", () => {
    const fake = createFakeTransport();
    const registry = new TopicSubscriptionRegistry({
      transport: fake.transport,
      teardownGraceMs: 0,
    });

    const snapshots: number[] = [];
    const offChange = registry.onRegistryChange((snap) => {
      snapshots.push(snap.totalSubscribers);
    });

    const received: unknown[] = [];
    registry.subscribe("pool.stats", (p) => received.push(p));
    registry.subscribe("notifications", (p) => received.push(p));

    expect(fake.getStats().subscribeCalls).toBe(2);

    registry.resubscribeAll();
    expect(fake.getStats().subscribeCalls).toBe(4);
    expect(fake.getStats().unsubscribeCalls).toBe(2);

    fake.emit("pool.stats", { totalUsdc: "100" });
    expect(received).toEqual([{ totalUsdc: "100" }]);

    offChange();
    registry.clear();
    expect(registry.getSnapshot().totalSubscribers).toBe(0);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
  });
});

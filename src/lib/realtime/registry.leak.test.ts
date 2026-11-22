import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionRegistry, type RegistryIntrospection } from "./registry";
import { FakeRegistryTransport, flushMicrotasks } from "./testing/leakHelpers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function makeRegistry() {
  const transport = new FakeRegistryTransport();
  const registry = new SubscriptionRegistry(transport);
  return { transport, registry };
}

/** Type-narrow helper so the test body reads cleanly. */
function snap(registry: SubscriptionRegistry): RegistryIntrospection {
  const s = registry.introspect();
  if (!s) throw new Error("introspect() returned null — is NODE_ENV 'production'?");
  return s;
}

describe("SubscriptionRegistry leak detection", () => {
  describe("subscribe / unsubscribe balance", () => {
    it("reaches zero after a single handler unsubscribes", async () => {
      const { transport, registry } = makeRegistry();
      const unsub = registry.subscribe("oracle_update", () => {});

      expect(snap(registry).activeTopicCount).toBe(1);
      expect(transport.balanceFor("oracle_update")).toBe(1);

      unsub();
      await flushMicrotasks();

      expect(snap(registry).activeTopicCount).toBe(0);
      expect(snap(registry).topicCount).toBe(0);
      expect(transport.balanceFor("oracle_update")).toBe(0);
    });

    it("reaches zero across multiple topics", async () => {
      const { transport, registry } = makeRegistry();
      const u1 = registry.subscribe("oracle_update", () => {});
      const u2 = registry.subscribe("claim_settled", () => {});

      expect(snap(registry).activeTopicCount).toBe(2);

      u1();
      u2();
      await flushMicrotasks();

      expect(snap(registry).activeTopicCount).toBe(0);
      expect(transport.balanceFor("oracle_update")).toBe(0);
      expect(transport.balanceFor("claim_settled")).toBe(0);
    });

    it("reference-counts multiple handlers on the same topic", async () => {
      const { transport, registry } = makeRegistry();
      const h1 = vi.fn();
      const h2 = vi.fn();
      const u1 = registry.subscribe("oracle_update", h1);
      const u2 = registry.subscribe("oracle_update", h2);

      expect(snap(registry).activeTopics).toEqual([
        { topic: "oracle_update", count: 2 },
      ]);
      expect(transport.activeCount).toBe(1);

      u1();
      expect(snap(registry).activeTopics).toEqual([
        { topic: "oracle_update", count: 1 },
      ]);

      u2();
      await flushMicrotasks();

      expect(snap(registry).activeTopicCount).toBe(0);
      expect(transport.activeCount).toBe(0);
    });

    it("survives repeated subscribe/unsubscribe cycles without accumulation", async () => {
      const { transport, registry } = makeRegistry();
      for (let i = 0; i < 10; i += 1) {
        const u = registry.subscribe("oracle_update", () => {});
        u();
        await flushMicrotasks();
      }
      expect(snap(registry).topicCount).toBe(0);
      expect(transport.subscribeCalls.length).toBe(1); // first opens, rest coalesce
      expect(transport.unsubscribeCalls.length).toBe(1);
    });
  });

  describe("transport subscription teardown", () => {
    it("unsubscribes from the transport when the last handler leaves", async () => {
      const { transport, registry } = makeRegistry();
      const unsub = registry.subscribe("oracle_update", () => {});

      expect(transport.isSubscribed("oracle_update")).toBe(true);

      unsub();
      await flushMicrotasks();

      expect(transport.isSubscribed("oracle_update")).toBe(false);
    });

    it("does not tear down while handlers remain", async () => {
      const { transport, registry } = makeRegistry();
      const u1 = registry.subscribe("oracle_update", () => {});
      registry.subscribe("oracle_update", () => {});

      u1();
      await flushMicrotasks();

      // Second handler keeps the transport subscription alive.
      expect(transport.isSubscribed("oracle_update")).toBe(true);
      expect(snap(registry).activeTopics).toEqual([
        { topic: "oracle_update", count: 1 },
      ]);
    });
  });

  describe("coalesced teardown (React StrictMode double-mount)", () => {
    it("cancels pending teardown when a new subscriber arrives in the same tick", async () => {
      const { transport, registry } = makeRegistry();

      // First mount.
      const u1 = registry.subscribe("oracle_update", () => {});
      // Unmount — schedules coalesced teardown.
      u1();

      // Second mount arrives before the microtask flushes.
      const u2 = registry.subscribe("oracle_update", () => {});
      await flushMicrotasks();

      // The transport subscription should NOT have been torn down and re-created.
      expect(transport.subscribeCalls.filter((t) => t === "oracle_update").length).toBe(1);
      expect(transport.unsubscribeCalls.filter((t) => t === "oracle_update").length).toBe(0);
      expect(snap(registry).activeTopics).toEqual([
        { topic: "oracle_update", count: 1 },
      ]);

      u2();
      await flushMicrotasks();
      expect(snap(registry).topicCount).toBe(0);
    });

    it("does tear down if no new subscriber arrives before the microtask", async () => {
      const { transport, registry } = makeRegistry();
      const unsub = registry.subscribe("oracle_update", () => {});
      unsub();

      // Before flushing: pending teardown is scheduled.
      expect(snap(registry).pendingTeardownTopics).toEqual(["oracle_update"]);

      await flushMicrotasks();

      expect(snap(registry).topicCount).toBe(0);
      expect(transport.activeCount).toBe(0);
      expect(snap(registry).pendingTeardownTopics).toEqual([]);
    });
  });

  describe("change listener cleanup", () => {
    it("removes listeners when their unsubscribe is called", () => {
      const { registry } = makeRegistry();
      const remove = registry.onChange(() => {});
      expect(snap(registry).listenerCount).toBe(1);

      remove();
      expect(snap(registry).listenerCount).toBe(0);
    });

    it("does not accumulate listeners across many add/remove cycles", () => {
      const { registry } = makeRegistry();
      for (let i = 0; i < 10; i += 1) {
        const remove = registry.onChange(() => {});
        remove();
      }
      expect(snap(registry).listenerCount).toBe(0);
    });
  });

  describe("guard: no references retained after full teardown", () => {
    it("introspection is completely empty after all topics and listeners are removed", async () => {
      const { registry } = makeRegistry();
      const u1 = registry.subscribe("oracle_update", () => {});
      const u2 = registry.subscribe("claim_settled", () => {});
      const removeListener = registry.onChange(() => {});

      u1();
      u2();
      removeListener();
      await flushMicrotasks();

      const s = snap(registry);
      expect(s.topicCount).toBe(0);
      expect(s.activeTopicCount).toBe(0);
      expect(s.listenerCount).toBe(0);
      expect(s.pendingTeardownTopics).toEqual([]);
      expect(s.transportSubscribedTopics).toEqual([]);
      expect(s.activeTopics).toEqual([]);
    });

    it("does not leak handlers after an unsubscribe is called twice (idempotency)", async () => {
      const { registry } = makeRegistry();
      const unsub = registry.subscribe("oracle_update", () => {});

      unsub();
      unsub(); // idempotent — should be a no-op
      await flushMicrotasks();

      expect(snap(registry).topicCount).toBe(0);
    });
  });
});

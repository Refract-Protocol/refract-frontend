import { describe, expect, it } from "vitest";
import { ConnectionLimitsEnforcer } from "./limits";

describe("ConnectionLimitsEnforcer", () => {
  it("does not count refcounted duplicate subscriptions against maxTopicsPerConnection", () => {
    const enforcer = new ConnectionLimitsEnforcer({
      maxTopicsPerConnection: 2,
    });

    const first = enforcer.acquireSubscription("oracle.readings");
    const duplicate = enforcer.acquireSubscription("oracle.readings");
    const secondTopic = enforcer.acquireSubscription("pool.stats");

    expect(first).toEqual({
      admitted: true,
      mode: "realtime",
      topic: "oracle.readings",
      refCount: 1,
    });
    expect(duplicate).toEqual({
      admitted: true,
      mode: "realtime",
      topic: "oracle.readings",
      refCount: 2,
    });
    expect(secondTopic.admitted).toBe(true);
    expect(enforcer.getDiagnostics().activeTopics).toHaveLength(2);
  });

  it("rejects low-priority subscriptions when at capacity and evicts low-priority topics for high-priority ones", () => {
    const degradedLog: Array<{ topic: string; reason: string }> = [];
    const enforcer = new ConnectionLimitsEnforcer({
      maxTopicsPerConnection: 2,
      onDegradeTopic: (topic, reason) => degradedLog.push({ topic, reason }),
    });

    expect(enforcer.acquireSubscription("claims.settlement").admitted).toBe(true); // priority 90
    expect(enforcer.acquireSubscription("pool.stats").admitted).toBe(true); // priority 50

    // Low-priority oracle.readings (30) is rejected and stays on REST fallback
    const rejected = enforcer.acquireSubscription("oracle.readings");
    expect(rejected).toEqual({
      admitted: false,
      mode: "rest_fallback",
      topic: "oracle.readings",
      reason: "topic_limit_exceeded",
    });

    // High-priority notifications (100) evicts pool.stats (50)
    const admittedHigh = enforcer.acquireSubscription("notifications");
    expect(admittedHigh).toEqual({
      admitted: true,
      mode: "realtime",
      topic: "notifications",
      refCount: 1,
      evictedTopic: "pool.stats",
    });

    const diag = enforcer.getDiagnostics();
    expect(diag.rejectedSubscriptions).toBe(1);
    expect(diag.evictedSubscriptions).toBe(1);
    expect(diag.degradedTopics).toEqual(["oracle.readings", "pool.stats"]);
    expect(degradedLog).toHaveLength(2);
  });

  it("recovers and admits previously degraded topics when a slot frees up", () => {
    const enforcer = new ConnectionLimitsEnforcer({
      maxTopicsPerConnection: 1,
    });

    expect(enforcer.acquireSubscription("notifications").admitted).toBe(true);
    expect(enforcer.acquireSubscription("oracle.readings").admitted).toBe(false);

    enforcer.releaseSubscription("notifications");

    const recovered = enforcer.acquireSubscription("oracle.readings");
    expect(recovered.admitted).toBe(true);
    expect(enforcer.getDiagnostics().degradedTopics).toEqual([]);
  });

  it("counts inbound rate-limit breaches and degrades the lowest-priority active topic", () => {
    let clock = 1_000;
    const enforcer = new ConnectionLimitsEnforcer({
      maxTopicsPerConnection: 4,
      maxMessagesPerSecond: 3,
      rateWindowMs: 1_000,
      now: () => clock,
    });

    enforcer.acquireSubscription("notifications");
    enforcer.acquireSubscription("oracle.readings");

    expect(enforcer.recordInboundMessage("oracle.readings").allowed).toBe(true);
    expect(enforcer.recordInboundMessage("oracle.readings").allowed).toBe(true);
    expect(enforcer.recordInboundMessage("oracle.readings").allowed).toBe(true);

    // 4th message within 1,000ms window breaches limit and degrades lowest-priority topic (oracle.readings)
    const breach = enforcer.recordInboundMessage("oracle.readings");
    expect(breach.allowed).toBe(false);
    expect(breach.mode).toBe("rest_fallback");
    expect(breach.reason).toBe("rate_limit_exceeded");

    const diag = enforcer.getDiagnostics();
    expect(diag.rateLimitBreaches).toBe(1);
    expect(diag.degradedTopics).toContain("oracle.readings");
    // High-priority notifications remains active
    expect(diag.activeTopics.map((t) => t.topic)).toEqual(["notifications"]);

    // After window slides past 1,000ms, notifications can still receive messages
    clock = 2_500;
    expect(enforcer.recordInboundMessage("notifications").allowed).toBe(true);
  });
});

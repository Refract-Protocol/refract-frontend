import { describe, expect, it } from "vitest";
import { DedupeCache, type DeduplicatableFrame } from "./dedup";

describe("DedupeCache (Message Idempotency & Event-ID Deduplication)", () => {
  it("passes first delivery, suppresses duplicate IDs per topic, and counts drops", () => {
    const cache = new DedupeCache({ maxEntriesPerTopic: 10, ttlMs: 60_000 });

    const first = cache.shouldDeliver({
      topic: "claims.settlement",
      id: "evt_claim_1",
      seq: 10,
    });
    const duplicate = cache.shouldDeliver({
      topic: "claims.settlement",
      id: "evt_claim_1",
      seq: 10,
    });
    // Same ID on a different topic is independent
    const otherTopic = cache.shouldDeliver({
      topic: "notifications",
      id: "evt_claim_1",
      seq: 1,
    });

    expect(first).toEqual({ accepted: true, reason: "new" });
    expect(duplicate).toEqual({ accepted: false, reason: "duplicate_id" });
    expect(otherTopic).toEqual({ accepted: true, reason: "new" });

    const stats = cache.getStats();
    expect(stats.totalAccepted).toBe(2);
    expect(stats.totalDuplicateDrops).toBe(1);
    expect(stats.byTopic["claims.settlement"].duplicateDrops).toBe(1);
    expect(stats.byTopic["claims.settlement"].lastSeq).toBe(10);
  });

  it("evicts oldest entries by LRU capacity and TTL window so genuinely old IDs can be reprocessed", () => {
    let clock = 1_000;
    const cache = new DedupeCache({
      maxEntriesPerTopic: 2,
      ttlMs: 5_000,
      now: () => clock,
    });

    expect(cache.shouldDeliver({ topic: "oracle.readings", id: "id-1" }).accepted).toBe(true);
    expect(cache.shouldDeliver({ topic: "oracle.readings", id: "id-2" }).accepted).toBe(true);
    // Adding id-3 evicts id-1 due to maxEntriesPerTopic=2
    expect(cache.shouldDeliver({ topic: "oracle.readings", id: "id-3" }).accepted).toBe(true);

    expect(cache.shouldDeliver({ topic: "oracle.readings", id: "id-2" }).accepted).toBe(false);
    expect(cache.shouldDeliver({ topic: "oracle.readings", id: "id-1" }).accepted).toBe(true);

    // Advance clock past TTL (5_000ms) -> id-1 expires and is accepted again
    clock = 10_000;
    expect(cache.shouldDeliver({ topic: "oracle.readings", id: "id-1" }).accepted).toBe(true);
  });

  it("passes through synthetic events without an ID while incrementing missingIdCount", () => {
    const cache = new DedupeCache();

    const d1 = cache.shouldDeliver({ topic: "pool.stats", seq: 4 });
    const d2 = cache.shouldDeliver({ topic: "pool.stats", id: "   ", seq: 5 });

    expect(d1).toEqual({ accepted: true, reason: "missing_id" });
    expect(d2).toEqual({ accepted: true, reason: "missing_id" });

    const stats = cache.getStats();
    expect(stats.totalMissingIds).toBe(2);
    expect(stats.totalAccepted).toBe(2);
    expect(stats.byTopic["pool.stats"].lastSeq).toBe(5);
  });

  it("delivers each event once when replaying a recorded event stream twice and supports reset", () => {
    const cache = new DedupeCache();
    const stream: DeduplicatableFrame[] = [
      { topic: "claims.settlement", id: "c-101", seq: 101, payload: { payout: "100" } },
      { topic: "claims.settlement", id: "c-102", seq: 102, payload: { payout: "200" } },
      { topic: "notifications", id: "n-1", seq: 1, payload: { title: "Alert" } },
    ];

    const firstPass = cache.filterBatch(stream);
    const replayedPass = cache.filterBatch(stream);

    expect(firstPass).toHaveLength(3);
    expect(replayedPass).toHaveLength(0);
    expect(cache.getStats().totalDuplicateDrops).toBe(3);

    // Resetting on account/network switch clears state
    cache.reset();
    const afterResetPass = cache.filterBatch(stream);
    expect(afterResetPass).toHaveLength(3);
  });
});

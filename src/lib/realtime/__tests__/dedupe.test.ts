import { describe, expect, it } from "vitest";
import { DedupeCache } from "../dedupe";

describe("DedupeCache", () => {
  it("passes the first delivery and drops repeats", () => {
    const cache = new DedupeCache();
    expect(cache.check("claim_settled", "c-1")).toBe("fresh");
    expect(cache.check("claim_settled", "c-1")).toBe("duplicate");
    expect(cache.check("claim_settled", "c-2")).toBe("fresh");
  });

  it("scopes ids per topic", () => {
    const cache = new DedupeCache();
    expect(cache.check("oracle_update", "1")).toBe("fresh");
    expect(cache.check("pool_stats", "1")).toBe("fresh");
  });

  it("passes events with no id through and counts them", () => {
    const cache = new DedupeCache();
    expect(cache.check("pool_stats", undefined)).toBe("untracked");
    expect(cache.check("pool_stats", undefined)).toBe("untracked");
    expect(cache.getStats()).toMatchObject({
      missingId: 2,
      perTopic: { pool_stats: { missingId: 2 } },
    });
  });

  it("evicts the oldest id once the window is full, so it can be processed again", () => {
    const cache = new DedupeCache({ maxEntriesPerTopic: 3 });
    ["a", "b", "c", "d"].forEach((id) => cache.check("t", id));
    expect(cache.size("t")).toBe(3);
    expect(cache.check("t", "a")).toBe("fresh");
    expect(cache.check("t", "d")).toBe("duplicate");
  });

  it("forgets ids after the TTL", () => {
    let now = 0;
    const cache = new DedupeCache({ ttlMs: 1_000, now: () => now });
    cache.check("t", "x");
    now = 999;
    expect(cache.check("t", "x")).toBe("duplicate");
    now = 1_000;
    expect(cache.check("t", "x")).toBe("fresh");
  });

  it("counts duplicates accurately per topic", () => {
    const cache = new DedupeCache();
    for (let i = 0; i < 3; i++) cache.check("a", "1");
    for (let i = 0; i < 2; i++) cache.check("b", "1");
    expect(cache.getStats()).toEqual({
      duplicatesDropped: 3,
      missingId: 0,
      perTopic: {
        a: { duplicatesDropped: 2, missingId: 0 },
        b: { duplicatesDropped: 1, missingId: 0 },
      },
    });
  });

  it("reset() forgets ids but keeps counters", () => {
    const cache = new DedupeCache();
    cache.check("t", "1");
    cache.check("t", "1");
    cache.reset();
    expect(cache.check("t", "1")).toBe("fresh");
    expect(cache.getStats().duplicatesDropped).toBe(1);
  });
});

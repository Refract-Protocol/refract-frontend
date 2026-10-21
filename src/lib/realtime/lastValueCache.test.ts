import { describe, it, expect } from "vitest";
import { LastValueCache } from "./lastValueCache";

describe("LastValueCache", () => {
  it("normalizes keys and keeps only the latest value", () => {
    const c = new LastValueCache();
    c.set(" Oracle ", 1);
    c.set("oracle", 2);
    expect(c.size).toBe(1);
    expect(c.get("ORACLE")?.value).toBe(2);
  });

  it("evicts the oldest entry past maxEntries", () => {
    const c = new LastValueCache({ maxEntries: 2 });
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("c")?.value).toBe(3);
  });

  it("expires entries after the TTL", () => {
    let t = 0;
    const c = new LastValueCache({ ttlMs: 100, now: () => t });
    c.set("a", 1);
    t = 101;
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it("clears all entries", () => {
    const c = new LastValueCache();
    c.set("a", 1);
    c.clear();
    expect(c.get("a")).toBeUndefined();
  });
});

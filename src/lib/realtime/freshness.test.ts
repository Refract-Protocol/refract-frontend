import { describe, expect, it } from "vitest";
import { getFreshness } from "./freshness";

describe("realtime freshness thresholds", () => {
  it("uses fresh, aging, and stale boundaries consistently", () => {
    expect(getFreshness(70_000, 100_000, 30_000)).toBe("fresh");
    expect(getFreshness(69_999, 100_000, 30_000)).toBe("aging");
    expect(getFreshness(40_000, 100_000, 30_000)).toBe("aging");
    expect(getFreshness(39_999, 100_000, 30_000)).toBe("stale");
  });

  it("handles absent timestamps and future clock skew", () => {
    expect(getFreshness(null, 100_000)).toBe("unknown");
    expect(getFreshness(101_000, 100_000)).toBe("fresh");
  });

  it("holds the previous non-stale state through brief reconnect churn", () => {
    expect(getFreshness(0, 65_000, 30_000, 62_000)).toBe("aging");
    expect(getFreshness(0, 67_000, 30_000, 62_000)).toBe("stale");
  });
});

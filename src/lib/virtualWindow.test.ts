import { describe, expect, it } from "vitest";
import { computeWindow } from "./virtualWindow";

describe("computeWindow", () => {
  it("handles empty lists", () => {
    expect(computeWindow(0, 40, 0, 300)).toEqual({ start: 0, end: 0, offsetTop: 0, totalHeight: 0 });
  });
  it("starts at index 0 with no negative overscan", () => {
    const w = computeWindow(1000, 40, 0, 400, 2);
    expect(w.start).toBe(0);
    expect(w.end).toBe(12);
  });
  it("clamps at the last index", () => {
    const w = computeWindow(100, 40, 1_000_000, 400, 2);
    expect(w.end).toBe(100);
    expect(w.start).toBeLessThan(100);
  });
  it("renders a bounded number of rows for a huge feed", () => {
    const w = computeWindow(50_000, 40, 400_000, 400);
    expect(w.end - w.start).toBeLessThanOrEqual(10 + 2 * 4);
    expect(w.totalHeight).toBe(2_000_000);
  });
  it("keeps offsets aligned to rows", () => {
    const w = computeWindow(500, 50, 2000, 500, 3);
    expect(w.offsetTop).toBe(w.start * 50);
  });
});

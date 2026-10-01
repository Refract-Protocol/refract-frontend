import { describe, it, expect } from "vitest";
import {
  calculatePremium,
  toggleCoverageSelection,
  getEffectiveMaxCoverage,
  getEffectiveMinCoverage,
} from "./premium";

describe("calculatePremium", () => {
  it("computes premium correctly for standard duration and rate", () => {
    // 5000 USD * 3% annual * 30 days / 365 = 5000 * 0.03 * (30/365) = 12.3287...
    const result = calculatePremium(5000, 3.0, 30);
    expect(result).toBeCloseTo(12.3287, 3);
  });

  it("handles string coverage amount", () => {
    const result = calculatePremium("10000", 6.0, 365);
    expect(result).toBeCloseTo(600, 2);
  });

  it("returns 0 for zero or negative amount, rate, or duration", () => {
    expect(calculatePremium(0, 3.0, 30)).toBe(0);
    expect(calculatePremium(-100, 3.0, 30)).toBe(0);
    expect(calculatePremium(5000, 0, 30)).toBe(0);
    expect(calculatePremium(5000, 3.0, 0)).toBe(0);
    expect(calculatePremium("invalid", 3.0, 30)).toBe(0);
  });
});

describe("toggleCoverageSelection", () => {
  it("allows selecting between min (2) and max (4) items", () => {
    const initial = [0, 1];

    // Adding 3rd item
    const addResult = toggleCoverageSelection(initial, 2, 2, 4);
    expect(addResult.selected).toEqual([0, 1, 2]);
    expect(addResult.error).toBeUndefined();

    // Adding 4th item
    const add4th = toggleCoverageSelection([0, 1, 2], 3, 2, 4);
    expect(add4th.selected).toEqual([0, 1, 2, 3]);
    expect(add4th.error).toBeUndefined();

    // Trying to add 5th item fails with error
    const add5th = toggleCoverageSelection([0, 1, 2, 3], 4, 2, 4);
    expect(add5th.selected).toEqual([0, 1, 2, 3]);
    expect(add5th.error).toBe("You can compare up to 4 coverage types at once");

    // Deselecting from 4 to 3 works
    const removeOne = toggleCoverageSelection([0, 1, 2, 3], 3, 2, 4);
    expect(removeOne.selected).toEqual([0, 1, 2]);

    // Deselecting when at min (2) fails with error
    const removeAtMin = toggleCoverageSelection([0, 1], 1, 2, 4);
    expect(removeAtMin.selected).toEqual([0, 1]);
    expect(removeAtMin.error).toBe("Select at least 2 coverage types to compare");
  });
});

describe("getEffectiveMaxCoverage", () => {
  it("clamps catalog max to chain max when chain bound is tighter", () => {
    expect(getEffectiveMaxCoverage(100_000, 50_000)).toBe(50_000);
  });

  it("retains catalog max when catalog max is tighter than chain max", () => {
    expect(getEffectiveMaxCoverage(2_000, 50_000)).toBe(2_000);
  });

  it("uses catalog max when chain bound is null or undefined", () => {
    expect(getEffectiveMaxCoverage(100_000, null)).toBe(100_000);
    expect(getEffectiveMaxCoverage(100_000, undefined)).toBe(100_000);
  });
});

describe("getEffectiveMinCoverage", () => {
  it("enforces minimum $100 floor", () => {
    expect(getEffectiveMinCoverage(null)).toBe(100);
    expect(getEffectiveMinCoverage(50)).toBe(100);
    expect(getEffectiveMinCoverage(500)).toBe(500);
  });
});

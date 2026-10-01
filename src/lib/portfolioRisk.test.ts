import { describe, it, expect } from "vitest";
import { aggregateExposure, getPoolRiskAssessment } from "./portfolioRisk";
import type { Policy } from "./api/policies";

describe("aggregateExposure", () => {
  it("handles 0 policies gracefully", () => {
    const empty = aggregateExposure([]);
    expect(empty.totalExposure).toBe(0);
    expect(empty.breakdowns).toEqual([]);
    expect(empty.maxSingleCategory).toBeNull();
    expect(empty.concentrationRisk).toBe("none");

    const nullResult = aggregateExposure(null);
    expect(nullResult.totalExposure).toBe(0);
  });

  it("handles a single policy correctly (100% share)", () => {
    const single: Policy[] = [
      {
        id: "p-1",
        holder: "GABC...",
        coverageType: 0,
        coverageTypeName: "Stablecoin Depeg",
        coverageAmount: (5_000 * 1e7).toString(),
        premium: (150 * 1e7).toString(),
        durationDays: 30,
        expiresAt: 1700000000,
        isActive: true,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];

    const res = aggregateExposure(single);
    expect(res.totalExposure).toBe(5000);
    expect(res.activeExposure).toBe(5000);
    expect(res.breakdowns.length).toBe(1);
    expect(res.breakdowns[0].coverageType).toBe(0);
    expect(res.breakdowns[0].totalAmount).toBe(5000);
    expect(res.breakdowns[0].percentageOfTotal).toBe(100);
    expect(res.concentrationRisk).toBe("high");
  });

  it("aggregates multiple policies and combines duplicate coverage types correctly", () => {
    const policies: Policy[] = [
      {
        id: "p-1",
        holder: "GABC...",
        coverageType: 0,
        coverageTypeName: "Stablecoin Depeg",
        coverageAmount: (4_000 * 1e7).toString(),
        premium: "100",
        durationDays: 30,
        expiresAt: 1700000000,
        isActive: true,
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "p-2",
        holder: "GABC...",
        coverageType: 0,
        coverageTypeName: "Stablecoin Depeg",
        coverageAmount: (6_000 * 1e7).toString(),
        premium: "150",
        durationDays: 60,
        expiresAt: 1700000000,
        isActive: true,
        createdAt: "2026-01-02T00:00:00Z",
      },
      {
        id: "p-3",
        holder: "GABC...",
        coverageType: 1,
        coverageTypeName: "Market Crash",
        coverageAmount: (10_000 * 1e7).toString(),
        premium: "300",
        durationDays: 30,
        expiresAt: 1700000000,
        isActive: false, // Expired
        createdAt: "2026-01-01T00:00:00Z",
      },
    ];

    const res = aggregateExposure(policies);
    // Total = 4k + 6k + 10k = 20k
    expect(res.totalExposure).toBe(20000);
    // Active = 4k + 6k = 10k
    expect(res.activeExposure).toBe(10000);

    expect(res.breakdowns.length).toBe(2);

    const depeg = res.breakdowns.find((b) => b.coverageType === 0);
    expect(depeg?.totalAmount).toBe(10000);
    expect(depeg?.policyCount).toBe(2);
    expect(depeg?.percentageOfTotal).toBe(50);

    const crash = res.breakdowns.find((b) => b.coverageType === 1);
    expect(crash?.totalAmount).toBe(10000);
    expect(crash?.policyCount).toBe(1);
    expect(crash?.percentageOfTotal).toBe(50);
  });
});

describe("getPoolRiskAssessment", () => {
  it("classifies high utilization correctly (>75%)", () => {
    const risk = getPoolRiskAssessment(8500); // 85%
    expect(risk.level).toBe("high");
    expect(risk.title).toBe("High Pool Utilization");
    expect(risk.message).toContain("proportional");
  });

  it("classifies moderate utilization (45-75%)", () => {
    const risk = getPoolRiskAssessment(6000); // 60%
    expect(risk.level).toBe("moderate");
    expect(risk.title).toBe("Moderate Pool Utilization");
  });

  it("classifies low utilization (<45%)", () => {
    const risk = getPoolRiskAssessment(2500); // 25%
    expect(risk.level).toBe("low");
    expect(risk.title).toBe("Optimal Capital Reserves");
  });
});

import type { Policy } from "./api/policies";
import { fromStroops } from "./format";

export interface ExposureBreakdown {
  coverageType: number;
  coverageTypeName: string;
  totalAmount: number;
  policyCount: number;
  percentageOfTotal: number;
  color: string;
  icon: string;
}

export interface PortfolioRiskSummary {
  totalExposure: number;
  activeExposure: number;
  breakdowns: ExposureBreakdown[];
  maxSingleCategory: ExposureBreakdown | null;
  concentrationRisk: "low" | "medium" | "high" | "none";
}

const TYPE_CONFIG: Record<number, { name: string; color: string; icon: string }> = {
  0: { name: "Stablecoin Depeg", color: "#8b5cf6", icon: "🪙" },
  1: { name: "Market Crash", color: "#f59e0b", icon: "📉" },
  2: { name: "Liquidation Shield", color: "#10b981", icon: "🛡️" },
  3: { name: "Smart Contract Risk", color: "#ef4444", icon: "🔐" },
  4: { name: "Flight Delay", color: "#06b6d4", icon: "✈️" },
};

/**
 * Aggregates holder policies into exposure by coverage type and evaluates portfolio risk.
 */
export function aggregateExposure(policies: Policy[] | null | undefined): PortfolioRiskSummary {
  if (!policies || policies.length === 0) {
    return {
      totalExposure: 0,
      activeExposure: 0,
      breakdowns: [],
      maxSingleCategory: null,
      concentrationRisk: "none",
    };
  }

  const map = new Map<number, { coverageTypeName: string; totalAmount: number; policyCount: number }>();
  let totalExposure = 0;
  let activeExposure = 0;

  for (const policy of policies) {
    const amount = fromStroops(policy.coverageAmount);
    totalExposure += amount;
    if (policy.isActive) {
      activeExposure += amount;
    }

    const existing = map.get(policy.coverageType);
    if (existing) {
      existing.totalAmount += amount;
      existing.policyCount += 1;
    } else {
      map.set(policy.coverageType, {
        coverageTypeName: policy.coverageTypeName || TYPE_CONFIG[policy.coverageType]?.name || `Type ${policy.coverageType}`,
        totalAmount: amount,
        policyCount: 1,
      });
    }
  }

  const breakdowns: ExposureBreakdown[] = Array.from(map.entries()).map(([typeId, data]) => {
    const config = TYPE_CONFIG[typeId] || { name: data.coverageTypeName, color: "#8b5cf6", icon: "📋" };
    const pct = totalExposure > 0 ? (data.totalAmount / totalExposure) * 100 : 0;
    return {
      coverageType: typeId,
      coverageTypeName: data.coverageTypeName,
      totalAmount: data.totalAmount,
      policyCount: data.policyCount,
      percentageOfTotal: Math.round(pct * 10) / 10,
      color: config.color,
      icon: config.icon,
    };
  });

  // Sort by highest exposure first
  breakdowns.sort((a, b) => b.totalAmount - a.totalAmount);

  const maxSingleCategory = breakdowns.length > 0 ? breakdowns[0] : null;

  let concentrationRisk: "low" | "medium" | "high" | "none" = "low";
  if (breakdowns.length === 0) {
    concentrationRisk = "none";
  } else if (breakdowns.length === 1 || (maxSingleCategory && maxSingleCategory.percentageOfTotal > 65)) {
    concentrationRisk = "high";
  } else if (maxSingleCategory && maxSingleCategory.percentageOfTotal > 40) {
    concentrationRisk = "medium";
  }

  return {
    totalExposure,
    activeExposure,
    breakdowns,
    maxSingleCategory,
    concentrationRisk,
  };
}

export interface PoolRiskAssessment {
  level: "low" | "moderate" | "high";
  utilizationPct: number;
  title: string;
  message: string;
}

/**
 * Assesses qualitative pool risk based on current utilization basis points.
 */
export function getPoolRiskAssessment(utilizationBps: number): PoolRiskAssessment {
  const utilizationPct = utilizationBps / 100;

  if (utilizationPct > 75) {
    return {
      level: "high",
      utilizationPct,
      title: "High Pool Utilization",
      message:
        "Pool capacity is heavily utilized. Payouts remain proportional per the pool's mechanics under peak concurrent claims.",
    };
  } else if (utilizationPct > 45) {
    return {
      level: "moderate",
      utilizationPct,
      title: "Moderate Pool Utilization",
      message:
        "Pool utilization is healthy and balanced. Reserves actively back open policies with standard risk distribution.",
    };
  } else {
    return {
      level: "low",
      utilizationPct,
      title: "Optimal Capital Reserves",
      message:
        "Ample unallocated liquidity is available in the underwriting pool to cover sudden multi-category claim triggers.",
    };
  }
}

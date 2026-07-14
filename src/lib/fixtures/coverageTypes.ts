import type { CoverageTypeInfo } from "@/lib/api/policies";

/**
 * FIXTURE — not live data.
 *
 * Mirrors the exact response of GET /api/v1/policies/types in
 * refract-backend/src/routes/policies.ts. Used as a fallback when the
 * backend API is unreachable (e.g. this environment) so the UI can still
 * be exercised end-to-end. If the backend's coverage catalogue changes,
 * update both places.
 */
export const FIXTURE_COVERAGE_TYPES: CoverageTypeInfo[] = [
  {
    id: 0,
    name: "Stablecoin Depeg",
    description: "Pays out if a major stablecoin depegs below $0.95",
    riskLevel: "medium",
    riskMultiplier: 1.0,
    baseRatePct: 3.0,
    maxCoverage: 100_000,
    trigger: "USDC price < $0.95 for 15+ minutes",
    icon: "🪙",
  },
  {
    id: 1,
    name: "Market Crash",
    description: "Covers catastrophic market downturns exceeding 30% in 24h",
    riskLevel: "high",
    riskMultiplier: 1.5,
    baseRatePct: 4.5,
    maxCoverage: 50_000,
    trigger: "Market index 24h return < -30%",
    icon: "📉",
  },
  {
    id: 2,
    name: "Liquidation Shield",
    description: "Pays out if your DeFi position gets liquidated",
    riskLevel: "high",
    riskMultiplier: 2.0,
    baseRatePct: 6.0,
    maxCoverage: 200_000,
    trigger: "Collateral ratio drops below maintenance threshold",
    icon: "🛡️",
  },
  {
    id: 3,
    name: "Smart Contract Risk",
    description: "Protection against smart contract exploits and hacks",
    riskLevel: "critical",
    riskMultiplier: 3.0,
    baseRatePct: 9.0,
    maxCoverage: 500_000,
    trigger: "Covered protocol TVL drops >50% in <1 hour",
    icon: "🔐",
  },
  {
    id: 4,
    name: "Flight Delay",
    description: "Automatic payout for flight delays over 2 hours",
    riskLevel: "low",
    riskMultiplier: 0.8,
    baseRatePct: 2.4,
    maxCoverage: 2_000,
    trigger: "Flight delayed > 120 minutes per AviationStack data",
    icon: "✈️",
  },
];

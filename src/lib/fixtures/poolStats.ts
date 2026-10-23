import type { PoolAllocation, PoolStats, UserPoolPosition } from "@/lib/api/pool";

/**
 * FIXTURE — not live data.
 *
 * Mirrors the exact response of GET /api/v1/pool/stats in
 * refract-backend/src/routes/pool.ts (mockPool), used as a fallback when
 * the backend is unreachable. Amounts are base-unit strings (1e7 per USDC),
 * same as the live endpoint.
 */
export const FIXTURE_POOL_STATS: PoolStats = {
  totalUsdc: (18_400_000 * 1e7).toString(),
  totalShares: (17_800_000 * 1e7).toString(),
  lockedUsdc: (2_900_000 * 1e7).toString(),
  premiumAccrued: (284_000 * 1e7).toString(),
  availableUsdc: (15_500_000 * 1e7).toString(),
  utilizationBps: 1576,
  apyBps: 890,
  sharePrice: 1.0319,
  maxUtilizationBps: 8000,
};

/**
 * FIXTURE — not live data.
 *
 * Mirrors GET /api/v1/pool/user/:address's mock response shape (the backend
 * itself returns a fixed mock position for any address today).
 */
export function fixtureUserPoolPosition(address: string): UserPoolPosition {
  const shares = 30_000 * 1e7;
  const usdcValue = shares * FIXTURE_POOL_STATS.sharePrice;
  return {
    address,
    shares: shares.toString(),
    usdcValue: usdcValue.toFixed(0),
    premiumEarned: (usdcValue * 0.089 * 0.5).toFixed(0),
    pct: ((shares / Number(FIXTURE_POOL_STATS.totalShares)) * 100).toFixed(4),
  };
}

/** FIXTURE — not live data. Per-coverage-type exposure for the Capital Allocation card. */
export const FIXTURE_POOL_ALLOCATION: PoolAllocation = {
  asOf: "2026-01-01T00:00:00.000Z",
  categories: [
    { coverageType: "0", lockedUsdc: "1200000000000", activePolicies: 14 },
    { coverageType: "1", lockedUsdc: "850000000000", activePolicies: 9 },
    { coverageType: "2", lockedUsdc: "400000000000", activePolicies: 5 },
    { coverageType: "3", lockedUsdc: "300000000000", activePolicies: 4 },
    { coverageType: "4", lockedUsdc: "150000000000", activePolicies: 11 },
  ],
};

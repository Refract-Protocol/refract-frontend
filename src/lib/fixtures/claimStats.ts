import type { ClaimStats } from "@/lib/api/claims";

/**
 * FIXTURE — not live data.
 *
 * Fallback for GET /api/v1/claims/stats when the backend is unreachable.
 */
export const FIXTURE_CLAIM_STATS: ClaimStats = {
  activePolicies: 247,
  processedClaims: 12,
  totalPayout: (169_600 * 1e7).toString(),
  settlementConfigured: false,
};

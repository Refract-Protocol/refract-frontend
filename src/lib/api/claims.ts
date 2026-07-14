/**
 * Mirrors ClaimResult from refract-backend/src/services/claimProcessor.ts —
 * that's the shape the ClaimProcessor emits internally when a policy's
 * oracle condition is evaluated, but there is currently no HTTP route that
 * exposes it (no GET /api/v1/claims/* in refract-backend/src/routes/).
 *
 * TODO(backend): add a route — e.g. GET /api/v1/claims/holder/:address —
 * that surfaces ClaimProcessor's history so the dashboard can read real
 * claim/payout data instead of the fixture in src/lib/fixtures/claims.ts.
 */
export interface ClaimRecord {
  policyId: string;
  holder: string;
  coverageType: number;
  triggered: boolean;
  payout: string;
  reason: string;
  processedAt: number;
}

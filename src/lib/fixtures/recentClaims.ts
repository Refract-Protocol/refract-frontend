import type { ClaimRecord } from "@/lib/api/claims";

/**
 * FIXTURE — not live data.
 *
 * Fallback for GET /api/v1/claims/recent when the backend is unreachable,
 * so the landing page's "Recent payouts" section still has something
 * plausible to show. payout is a base-unit string (1e7 per USDC), same as
 * the live endpoint.
 */
export const FIXTURE_RECENT_CLAIMS: ClaimRecord[] = [
  {
    policyId: "fixture-1",
    holder: "GDEMOHOLDERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    coverageType: 0,
    triggered: true,
    payout: (48_200 * 1e7).toString(),
    reason: "USDC price: $0.9412 (-5.88% from peg)",
    processedAt: Date.now() - 3 * 86_400_000,
    settlementTxHash: "fixture-tx-abc",
  },
  {
    policyId: "fixture-2",
    holder: "GDEMOHOLDERADDRESSBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    coverageType: 1,
    triggered: true,
    payout: (120_000 * 1e7).toString(),
    reason: "XLM 24h change: -34.20% (trigger at -30%)",
    processedAt: Date.now() - 11 * 86_400_000,
    settlementTxHash: "fixture-tx-xyz",
  },
  {
    policyId: "fixture-3",
    holder: "GDEMOHOLDERADDRESSCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    coverageType: 4,
    triggered: true,
    payout: (1_400 * 1e7).toString(),
    reason: "Flight BA249: 145m delay (trigger at 120m)",
    processedAt: Date.now() - 14 * 86_400_000,
    settlementTxHash: "fixture-tx-qrs",
  },
];

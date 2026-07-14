import type { ClaimRecord } from "@/lib/api/claims";
import type { Policy } from "@/lib/api/policies";

/**
 * FIXTURE — not live data, and unlike the other fixtures in this folder
 * there isn't even a backend route to eventually replace it with yet (see
 * the TODO in src/lib/api/claims.ts). Derives a plausible claim history
 * from a holder's fixture policies: the one non-active, non-expired policy
 * ("Liquidation Shield" in fixtureHolderPolicies) is presented as
 * triggered and paid out, matching how ClaimProcessor.processPayout()
 * marks a policy inactive once it pays a claim.
 */
export function fixtureClaimsForHolder(holder: string, policies: Policy[]): ClaimRecord[] {
  const triggeredPolicy = policies.find((p) => p.coverageTypeName === "Liquidation Shield");
  if (!triggeredPolicy) return [];

  return [
    {
      policyId: triggeredPolicy.id,
      holder,
      coverageType: triggeredPolicy.coverageType,
      triggered: true,
      payout: triggeredPolicy.coverageAmount,
      reason: "Collateral ratio 81.4% below shield threshold",
      processedAt: new Date(triggeredPolicy.createdAt).getTime() + 9 * 86_400_000,
    },
  ];
}

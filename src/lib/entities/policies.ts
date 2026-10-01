import type { Policy } from "@/lib/api/policies";
import type { ClaimRecord } from "@/lib/api/claims";

export type PolicyStatus = "active" | "paid" | "expired";

export function normalizePolicies(policies: Policy[]): Record<string, Policy> {
  const byId: Record<string, Policy> = {};
  for (const policy of policies) byId[policy.id] = policy;
  return byId;
}

export function normalizeClaims(claims: ClaimRecord[]): Record<string, ClaimRecord> {
  const byPolicyId: Record<string, ClaimRecord> = {};
  for (const claim of claims) byPolicyId[claim.policyId] = claim;
  return byPolicyId;
}

/**
 * A claim can in principle reference a policyId not present in the current
 * policies set — treat that as "no claim" rather than throwing.
 */
export function selectPolicyStatus(
  policiesById: Record<string, Policy>,
  claimsByPolicyId: Record<string, ClaimRecord>,
  policyId: string,
): PolicyStatus {
  const policy = policiesById[policyId];
  const claim = claimsByPolicyId[policyId];
  if (claim?.triggered && policy) return "paid";
  return policy?.isActive ? "active" : "expired";
}

/**
 * Pure, memoizable selectors for the holder dashboard.
 *
 * These functions derive policy status and portfolio aggregates from raw
 * `Policy[]` and `ClaimRecord[]` inputs. They are intentionally free of React
 * and side effects so they can be unit tested and memoized at the call site.
 */

import type { Policy } from "@/lib/api/policies";
import type { ClaimRecord } from "@/lib/api/claims";
import { fromStroops } from "@/lib/format";

export type PolicyStatus = "active" | "expired" | "paid";

export type Provenance = "live" | "fixture" | "mixed";

/**
 * Builds an index of claims keyed by policy id so status resolution is O(1)
 * per policy instead of a linear `claims.find` scan.
 */
export function claimsByPolicyId(claims: ClaimRecord[]): Map<string, ClaimRecord[]> {
  const index = new Map<string, ClaimRecord[]>();
  for (const claim of claims) {
    const existing = index.get(claim.policyId);
    if (existing) {
      existing.push(claim);
    } else {
      index.set(claim.policyId, [claim]);
    }
  }
  return index;
}

/**
 * Resolves a policy's display status.
 *
 * A policy with a claim is `paid`. Otherwise it is `expired` when it is
 * inactive or its `expiresAt` is in the past, and `active` otherwise.
 */
export function policyStatus(
  policy: Policy,
  claims: ClaimRecord[] | Map<string, ClaimRecord[]>,
  now: number = Date.now(),
): PolicyStatus {
  const policyClaims = claims instanceof Map ? claims.get(policy.id) : claims;
  if (policyClaims && policyClaims.length > 0) return "paid";
  if (!policy.isActive) return "expired";
  if (policy.expiresAt && new Date(policy.expiresAt).getTime() < now) return "expired";
  return "active";
}

export interface PortfolioSummary {
  totalCoverage: number;
  activePolicies: number;
  totalPolicies: number;
  totalClaims: number;
  provenance: Provenance;
}

/**
 * Aggregates a portfolio into display-ready totals.
 *
 * Coverage is summed in base units with `BigInt` to avoid float drift and
 * converted once at the display boundary. Empty inputs yield zeroed totals.
 */
export function summarizePortfolio(
  policies: Policy[],
  claims: ClaimRecord[],
  provenance: Provenance = "live",
): PortfolioSummary {
  const index = claimsByPolicyId(claims);
  const now = Date.now();

  let coverageBase = 0n;
  let activePolicies = 0;

  for (const policy of policies) {
    coverageBase += BigInt(policy.coverageAmount || "0");
    if (policyStatus(policy, index, now) === "active") activePolicies += 1;
  }

  return {
    totalCoverage: fromStroops(coverageBase.toString()),
    activePolicies,
    totalPolicies: policies.length,
    totalClaims: claims.length,
    provenance,
  };
}

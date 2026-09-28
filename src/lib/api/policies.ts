import { apiRequest } from "./client";
import type { ApiSchemas } from "./generated";

/**
 * Types are generated from openapi/refract-api.yaml, a transcription of
 * refract-backend/src/routes/policies.ts (the source of truth). coverageAmount/premium are base-unit
 * strings (1e7 per USDC), matching the Soroban contract's integer amounts.
 */
export type RiskLevel = ApiSchemas["RiskLevel"];

export type CoverageTypeInfo = ApiSchemas["CoverageTypeInfo"];

export type Policy = ApiSchemas["Policy"];

export type BuyPolicyParams = ApiSchemas["BuyPolicyParams"];

export type BuyPolicyResponse = ApiSchemas["BuyPolicyResponse"];

export function fetchCoverageTypes(signal?: AbortSignal): Promise<{ coverageTypes: CoverageTypeInfo[] }> {
  return apiRequest("/policies/types", { signal });
}

export type CoverageBounds = ApiSchemas["CoverageBounds"];

/**
 * The pool's real, currently-configured min/max coverage — a single
 * global bound across every coverage type, unlike CoverageTypeInfo.maxCoverage
 * above (this API's own static per-type catalog). Real on-chain read.
 */
export function fetchCoverageBounds(signal?: AbortSignal): Promise<CoverageBounds> {
  return apiRequest("/policies/coverage-bounds", { signal });
}

export function fetchHolderPolicies(address: string, signal?: AbortSignal): Promise<{ policies: Policy[] }> {
  return apiRequest(`/policies/holder/${address}`, { signal });
}

export function buyPolicy(params: BuyPolicyParams): Promise<BuyPolicyResponse> {
  return apiRequest("/policies/buy", { method: "POST", body: params });
}

import { apiRequest } from "./client";

/**
 * Types mirror refract-backend/src/routes/policies.ts exactly — see that
 * file for the source of truth. coverageAmount/premium are base-unit
 * strings (1e7 per USDC), matching the Soroban contract's integer amounts.
 */
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface CoverageTypeInfo {
  id: number;
  name: string;
  description: string;
  riskLevel: RiskLevel;
  riskMultiplier: number;
  baseRatePct: number;
  maxCoverage: number;
  trigger: string;
  icon: string;
}

export interface Policy {
  id: string;
  holder: string;
  coverageType: number;
  coverageTypeName: string;
  coverageAmount: string;
  premium: string;
  durationDays: number;
  expiresAt: number;
  isActive: boolean;
  createdAt: string;
}

export interface BuyPolicyParams {
  holder: string;
  coverageType: number;
  coverageAmount: string;
  durationDays: number;
  triggerParams?: Record<string, unknown>;
}

export interface BuyPolicyResponse {
  policy: Policy;
  txXdr: string;
  message: string;
}

export function fetchCoverageTypes(signal?: AbortSignal): Promise<{ coverageTypes: CoverageTypeInfo[] }> {
  return apiRequest("/policies/types", { signal });
}

export function fetchHolderPolicies(address: string, signal?: AbortSignal): Promise<{ policies: Policy[] }> {
  return apiRequest(`/policies/holder/${address}`, { signal });
}

export function buyPolicy(params: BuyPolicyParams): Promise<BuyPolicyResponse> {
  return apiRequest("/policies/buy", { method: "POST", body: params });
}

import { apiRequest } from "./client";

/** Mirrors ClaimResult from refract-backend/src/claim/claim-result.ts. */
export interface ClaimRecord {
  policyId: string;
  holder: string;
  coverageType: number;
  triggered: boolean;
  payout: string;
  reason: string;
  processedAt: number;
  settlementTxHash?: string;
}

export function fetchHolderClaims(address: string, signal?: AbortSignal): Promise<{ claims: ClaimRecord[] }> {
  return apiRequest(`/claims/holder/${address}`, { signal });
}

export function fetchRecentClaims(signal?: AbortSignal): Promise<{ claims: ClaimRecord[] }> {
  return apiRequest("/claims/recent", { signal });
}

import { apiRequest } from "./client";
import type { ApiSchemas } from "./generated";

/** Types are generated from openapi/refract-api.yaml, which mirrors ClaimResult from refract-backend/src/claim/claim-result.ts. */
export type ClaimRecord = ApiSchemas["ClaimRecord"];

export function fetchHolderClaims(address: string, signal?: AbortSignal): Promise<{ claims: ClaimRecord[] }> {
  return apiRequest(`/claims/holder/${address}`, { signal });
}

export function fetchRecentClaims(signal?: AbortSignal): Promise<{ claims: ClaimRecord[] }> {
  return apiRequest("/claims/recent", { signal });
}

/** Types are generated from openapi/refract-api.yaml, which mirrors ClaimService.getStats()'s response in refract-backend. */
export type ClaimStats = ApiSchemas["ClaimStats"];

export function fetchClaimStats(signal?: AbortSignal): Promise<ClaimStats> {
  return apiRequest("/claims/stats", { signal });
}

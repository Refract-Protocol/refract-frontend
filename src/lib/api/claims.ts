import { apiRequest } from "./client";
import type { ApiSchemas } from "./generated";

/** Types are generated from openapi/refract-api.yaml, which mirrors ClaimResult from refract-backend/src/claim/claim-result.ts. */
export type ClaimRecord = ApiSchemas["ClaimRecord"];

/**
 * Assumed pagination contract (to be coordinated with refract-backend):
 * list endpoints accept optional `cursor` and `limit` query params and may
 * return `{ items, nextCursor, hasMore }`. When the backend does not yet
 * return pagination metadata, callers degrade gracefully to the legacy
 * `{ claims }` shape (fetch-everything-in-one-call).
 */
export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

function buildPaginationQuery({ cursor, limit }: PaginationParams = {}): string {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit != null) params.set("limit", String(limit));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * Normalizes a list response that may or may not include pagination metadata.
 * Falls back to the legacy `{ claims }` shape when metadata is absent.
 */
function normalizeClaimsResponse(
  response: { claims?: ClaimRecord[]; items?: ClaimRecord[]; nextCursor?: string; hasMore?: boolean },
): PaginatedResponse<ClaimRecord> {
  const items = response.items ?? response.claims ?? [];
  const hasMore = response.hasMore ?? false;
  return { items, nextCursor: response.nextCursor, hasMore };
}

export function fetchHolderClaims(
  address: string,
  params: PaginationParams = {},
  signal?: AbortSignal,
): Promise<PaginatedResponse<ClaimRecord>> {
  return apiRequest(`/claims/holder/${address}${buildPaginationQuery(params)}`, { signal }).then(
    normalizeClaimsResponse,
  );
}

export function fetchRecentClaims(
  params: PaginationParams = {},
  signal?: AbortSignal,
): Promise<PaginatedResponse<ClaimRecord>> {
  return apiRequest(`/claims/recent${buildPaginationQuery(params)}`, { signal }).then(
    normalizeClaimsResponse,
  );
}

/** Types are generated from openapi/refract-api.yaml, which mirrors ClaimService.getStats()'s response in refract-backend. */
export type ClaimStats = ApiSchemas["ClaimStats"];

export function fetchClaimStats(signal?: AbortSignal): Promise<ClaimStats> {
  return apiRequest("/claims/stats", { signal });
}

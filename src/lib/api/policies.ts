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

/**
 * Cursor/offset pagination request shape, applied uniformly across the
 * list-returning endpoints (see also src/lib/api/claims.ts).
 *
 * Assumed backend contract (refract-backend, not yet implemented):
 *   GET ...?cursor=<opaque>&limit=<n>
 *   -> { items: T[], nextCursor: string | null, hasMore: boolean }
 *
 * If the backend does not yet return pagination metadata, the response is
 * treated as a single, complete page (nextCursor: null, hasMore: false),
 * which is functionally equivalent to today's fetch-everything behavior.
 */
export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Normalizes a raw list response into the uniform paginated shape,
 * degrading gracefully when the backend omits pagination metadata.
 */
export function toPaginated<T>(raw: unknown, key: string): Paginated<T> {
  const record = (raw ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(record[key]) ? record[key] : []) as T[];
  const nextCursor = typeof record.nextCursor === "string" ? record.nextCursor : null;
  const hasMore = typeof record.hasMore === "boolean" ? record.hasMore : false;
  return { items, nextCursor, hasMore };
}

function paginationQuery(params?: PaginationParams): string {
  const search = new URLSearchParams();
  if (params?.cursor) search.set("cursor", params.cursor);
  if (typeof params?.limit === "number") search.set("limit", String(params.limit));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function fetchCoverageTypes(signal?: AbortSignal): Promise<{ coverageTypes: CoverageTypeInfo[] }> {
  return apiRequest("/policies/types", { signal });
}

export interface CoverageBounds {
  /** Base-unit strings (1e7 per USDC), or null if the pool contract isn't configured/initialized yet. */
  minCoverage: string | null;
  maxCoverage: string | null;
}

/**
 * The pool's real, currently-configured min/max coverage — a single
 * global bound across every coverage type, unlike CoverageTypeInfo.maxCoverage
 * above (this API's own static per-type catalog). Real on-chain read.
 */
export function fetchCoverageBounds(signal?: AbortSignal): Promise<CoverageBounds> {
  return apiRequest("/policies/coverage-bounds", { signal });
}

export async function fetchHolderPolicies(
  address: string,
  params?: PaginationParams,
  signal?: AbortSignal,
): Promise<Paginated<Policy>> {
  const raw = await apiRequest<{ policies?: Policy[] } & Partial<Paginated<Policy>>>(
    `/policies/holder/${address}${paginationQuery(params)}`,
    { signal },
  );
  return toPaginated<Policy>(raw, "policies");
}

export function buyPolicy(params: BuyPolicyParams): Promise<BuyPolicyResponse> {
  return apiRequest("/policies/buy", { method: "POST", body: params });
}

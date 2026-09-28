import { apiRequest } from "./client";
import type { ApiSchemas } from "./generated";

/** Types are generated from openapi/refract-api.yaml, which mirrors refract-backend/src/routes/pool.ts response shapes. */

export type PoolStats = ApiSchemas["PoolStats"];

export type UserPoolPosition = ApiSchemas["UserPoolPosition"];

export type ProvideCapitalResponse = ApiSchemas["ProvideCapitalResponse"];

export type WithdrawCapitalResponse = ApiSchemas["WithdrawCapitalResponse"];

export function fetchPoolStats(signal?: AbortSignal): Promise<PoolStats> {
  return apiRequest("/pool/stats", { signal });
}

export function fetchUserPoolPosition(address: string, signal?: AbortSignal): Promise<UserPoolPosition> {
  return apiRequest(`/pool/user/${address}`, { signal });
}

export type LockupStatus = ApiSchemas["LockupStatus"];

/** Real on-chain read (unlike stats/user, which stay mocked pending the Postgres wiring). */
export function fetchLockupStatus(address: string, signal?: AbortSignal): Promise<LockupStatus> {
  return apiRequest(`/pool/lockup/${address}`, { signal });
}

export function provideCapital(provider: string, amount: string): Promise<ProvideCapitalResponse> {
  return apiRequest("/pool/provide", { method: "POST", body: { provider, amount } });
}

export function withdrawCapital(provider: string, shares: string): Promise<WithdrawCapitalResponse> {
  return apiRequest("/pool/withdraw", { method: "POST", body: { provider, shares } });
}

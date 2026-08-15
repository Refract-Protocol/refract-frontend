import { apiRequest } from "./client";

/** Mirrors refract-backend/src/routes/pool.ts response shapes exactly. */

export interface PoolStats {
  totalUsdc: string;
  totalShares: string;
  lockedUsdc: string;
  premiumAccrued: string;
  availableUsdc: string;
  utilizationBps: number;
  apyBps: number;
  sharePrice: number;
  maxUtilizationBps: number;
}

export interface UserPoolPosition {
  address: string;
  shares: string;
  usdcValue: string;
  premiumEarned: string;
  pct: string;
}

export interface ProvideCapitalResponse {
  provider: string;
  amountUsdc: string;
  sharesOut: string;
  sharePrice: number;
  txXdr: string;
  message: string;
}

export interface WithdrawCapitalResponse {
  provider: string;
  sharesIn: string;
  usdcOut: string;
  sharePrice: number;
  txXdr: string;
}

export function fetchPoolStats(signal?: AbortSignal): Promise<PoolStats> {
  return apiRequest("/pool/stats", { signal });
}

export function fetchUserPoolPosition(address: string, signal?: AbortSignal): Promise<UserPoolPosition> {
  return apiRequest(`/pool/user/${address}`, { signal });
}

export interface LockupStatus {
  /** Unix seconds, or null if the address has never deposited (so isn't locked). */
  lockupExpiresAt: string | null;
}

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

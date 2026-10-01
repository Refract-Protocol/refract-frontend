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

/**
 * Real on-chain USDC trustline balance for an address.
 *
 * `balance` is a base-unit (stroops) string and must be run through `fromStroops`
 * before display. `hasTrustline` distinguishes an account that simply holds zero
 * USDC from one that has never established the USDC trustline at all — the two
 * need different, actionable messaging in the deposit flow.
 */
export interface UsdcBalance {
  address: string;
  balance: string;
  hasTrustline: boolean;
}

/** Real on-chain read; never falls back to a fixture (see useLockupStatus precedent). */
export function fetchUsdcBalance(address: string, signal?: AbortSignal): Promise<UsdcBalance> {
  return apiRequest(`/account/${address}/usdc-balance`, { signal });
}

/**
 * Per-coverage-type pool exposure: locked capital (base-unit stroops string) and
 * the number of active policies backing it, keyed by coverage type id.
 *
 * `asOf` is an ISO-8601 timestamp for the snapshot so the UI can render an
 * honest "as of" label rather than implying real-time accuracy.
 */
export interface PoolAllocationCategory {
  coverageType: string;
  lockedUsdc: string;
  activePolicies: number;
}

export interface PoolAllocation {
  asOf: string;
  categories: PoolAllocationCategory[];
}

/**
 * Real per-category exposure read. Unlike stats/user this is not mocked; the
 * caller (usePoolAllocation) decides how to surface an unreachable endpoint.
 */
export function fetchPoolAllocation(signal?: AbortSignal): Promise<PoolAllocation> {
  return apiRequest("/pool/allocation", { signal });
}

export function provideCapital(provider: string, amount: string): Promise<ProvideCapitalResponse> {
  return apiRequest("/pool/provide", { method: "POST", body: { provider, amount } });
}

export function withdrawCapital(provider: string, shares: string): Promise<WithdrawCapitalResponse> {
  return apiRequest("/pool/withdraw", { method: "POST", body: { provider, shares } });
}

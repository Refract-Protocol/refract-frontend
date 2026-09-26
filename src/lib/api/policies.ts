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

/**
 * Trigger parameters are a discriminated union keyed by coverage type id so
 * that adding a future parameterised coverage type stays type-safe. The
 * flight-delay type (id 4) is the only one that currently carries parameters:
 * the oracle (AviationStack) resolves the flight by designator and departure
 * date, so both are required for the trigger to be payable.
 */
export interface FlightDelayTriggerParams {
  flightNumber: string;
  departureDate: string;
}

export type TriggerParams = { coverageType: 4; params: FlightDelayTriggerParams };

export interface BuyPolicyParams {
  holder: string;
  coverageType: number;
  coverageAmount: string;
  durationDays: number;
  triggerParams?: TriggerParams;
}

export interface BuyPolicyResponse {
  policy: Policy;
  txXdr: string;
  message: string;
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

export function fetchHolderPolicies(address: string, signal?: AbortSignal): Promise<{ policies: Policy[] }> {
  return apiRequest(`/policies/holder/${address}`, { signal });
}

export function buyPolicy(params: BuyPolicyParams): Promise<BuyPolicyResponse> {
  return apiRequest("/policies/buy", { method: "POST", body: params });
}

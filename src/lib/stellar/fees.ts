import { HORIZON_URL } from "../network";

export type TxKind = "buy" | "provide" | "withdraw";

export const STROOPS_PER_XLM = 10_000_000;

/**
 * Rough per-operation Soroban resource fees, in stroops. These are ESTIMATES
 * based on typical footprints for each contract call (CPU, ledger reads/writes,
 * tx size) — the real resource fee is only known once the backend simulates
 * the built transaction, so never present these as guarantees.
 */
export const RESOURCE_FEE_ESTIMATE_STROOPS: Record<TxKind, number> = {
  buy: 150_000,
  provide: 120_000,
  withdraw: 120_000,
};

const FEE_STATS_TTL_MS = 60_000;

let cached: { inclusionFee: number; fetchedAt: number } | null = null;

/** Test-only: clears the in-memory fee-stats cache. */
export function resetFeeStatsCache(): void {
  cached = null;
}

/**
 * Current per-operation inclusion fee (stroops) from Horizon's /fee_stats,
 * cached for 60s. Uses the median fee charged, falling back to the last
 * ledger's base fee. Returns null if the fetch fails or the payload is unusable.
 */
export async function fetchInclusionFee(now = Date.now()): Promise<number | null> {
  if (cached && now - cached.fetchedAt < FEE_STATS_TTL_MS) return cached.inclusionFee;
  try {
    const res = await fetch(`${HORIZON_URL}/fee_stats`);
    if (!res.ok) return null;
    const stats = await res.json();
    const fee = Number(stats?.fee_charged?.p50 ?? stats?.last_ledger_base_fee);
    if (!Number.isFinite(fee) || fee <= 0) return null;
    cached = { inclusionFee: fee, fetchedAt: now };
    return fee;
  } catch {
    return null;
  }
}

/** Total estimated fee in stroops: network inclusion fee + static resource estimate. */
export function estimateFeeStroops(kind: TxKind, inclusionFee: number): number {
  return inclusionFee + RESOURCE_FEE_ESTIMATE_STROOPS[kind];
}

/** e.g. "~0.0151 XLM" */
export function formatFeeXlm(stroops: number): string {
  return `~${(stroops / STROOPS_PER_XLM).toFixed(4)} XLM`;
}

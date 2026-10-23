import type { StellarNetworkId } from "@/lib/network";

export type NetworkHealth = "healthy" | "degraded" | "unavailable";

export interface HealthSample {
  /** Age of the latest closed ledger in seconds; undefined if Horizon was unreachable. */
  ledgerAgeSec: number | undefined;
  rpcOk: boolean;
}

/** Ledger-age thresholds (seconds) beyond which the network is degraded. Testnets are flakier. */
export const DEGRADED_AFTER_SEC: Record<StellarNetworkId, number> = {
  mainnet: 30,
  testnet: 60,
  futurenet: 120,
};

/** Consecutive bad samples required before the badge worsens, so one miss doesn't flap it. */
export const FLAP_THRESHOLD = 2;

export function classifySample(network: StellarNetworkId, s: HealthSample): NetworkHealth {
  if (s.ledgerAgeSec === undefined && !s.rpcOk) return "unavailable";
  if (s.ledgerAgeSec === undefined || !s.rpcOk) return "degraded";
  return s.ledgerAgeSec > DEGRADED_AFTER_SEC[network] ? "degraded" : "healthy";
}

const RANK: Record<NetworkHealth, number> = { healthy: 0, degraded: 1, unavailable: 2 };

/** Improves immediately; worsens only after FLAP_THRESHOLD consecutive worse samples. */
export function nextHealth(
  current: NetworkHealth,
  sample: NetworkHealth,
  streak: number
): { health: NetworkHealth; streak: number } {
  if (RANK[sample] <= RANK[current]) return { health: sample, streak: 0 };
  const n = streak + 1;
  return n >= FLAP_THRESHOLD ? { health: sample, streak: 0 } : { health: current, streak: n };
}

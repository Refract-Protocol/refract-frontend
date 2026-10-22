import { ACTIVE_NETWORK, NETWORKS, type StellarNetworkId } from "@/lib/network";
import type { RealtimeScope } from "./contract";

/**
 * Query-key roots whose cached data is merged with realtime frames or is
 * wallet-scoped. On a scope change these are reset so old-scope snapshots are
 * never shown alongside new-scope realtime data.
 */
export const SCOPED_QUERY_ROOTS = new Set<string>([
  "oracleStatus",
  "recentClaims",
  "holderClaims",
  "holderPolicies",
  "userPoolPosition",
  "lockupStatus",
]);

export function isScopedQueryKey(queryKey: readonly unknown[]): boolean {
  return typeof queryKey[0] === "string" && SCOPED_QUERY_ROOTS.has(queryKey[0]);
}

/** Maps a wallet's network passphrase to our network id; unknown or missing → the app's configured network. */
export function networkIdFromPassphrase(passphrase: string | null | undefined): StellarNetworkId {
  if (passphrase) {
    for (const config of Object.values(NETWORKS)) {
      if (config.networkPassphrase === passphrase) return config.id;
    }
  }
  return ACTIVE_NETWORK.id;
}

export function deriveScope(wallet: {
  status: string;
  address: string | null;
  networkPassphrase: string | null;
}): RealtimeScope {
  const connected = wallet.status === "connected" && Boolean(wallet.address);
  return {
    network: connected ? networkIdFromPassphrase(wallet.networkPassphrase) : ACTIVE_NETWORK.id,
    account: connected ? wallet.address : null,
  };
}

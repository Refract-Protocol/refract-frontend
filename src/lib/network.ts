/**
 * Single source of truth for which Stellar network the app targets. Driven
 * by NEXT_PUBLIC_STELLAR_NETWORK (testnet | futurenet | mainnet), defaulting
 * to testnet when unset. An unrecognized value throws at module load so a
 * misconfigured build fails loudly instead of silently pointing at the
 * wrong chain.
 */
export type StellarNetworkId = "testnet" | "futurenet" | "mainnet";

export interface StellarNetworkConfig {
  id: StellarNetworkId;
  /** Human-readable name, e.g. "Stellar Testnet". */
  label: string;
  /** Short uppercase tag for the Navbar badge. */
  badge: string;
  explorerBaseUrl: string;
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
}

export const NETWORKS: Record<StellarNetworkId, StellarNetworkConfig> = {
  testnet: {
    id: "testnet",
    label: "Stellar Testnet",
    badge: "TESTNET",
    explorerBaseUrl: "https://stellar.expert/explorer/testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
  futurenet: {
    id: "futurenet",
    label: "Stellar Futurenet",
    badge: "FUTURENET",
    explorerBaseUrl: "https://stellar.expert/explorer/futurenet",
    rpcUrl: "https://rpc-futurenet.stellar.org",
    horizonUrl: "https://horizon-futurenet.stellar.org",
    networkPassphrase: "Test SDF Future Network ; October 2022",
  },
  mainnet: {
    id: "mainnet",
    label: "Stellar Mainnet",
    badge: "MAINNET",
    explorerBaseUrl: "https://stellar.expert/explorer/public",
    rpcUrl: "https://mainnet.sorobanrpc.com",
    horizonUrl: "https://horizon.stellar.org",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  },
};

export const DEFAULT_NETWORK: StellarNetworkId = "testnet";

/** Resolves a raw env value to a network config; throws on unrecognized values. */
export function resolveNetwork(raw: string | undefined): StellarNetworkConfig {
  const value = raw?.trim().toLowerCase();
  if (!value) return NETWORKS[DEFAULT_NETWORK];
  if (value in NETWORKS) return NETWORKS[value as StellarNetworkId];
  throw new Error(
    `Unrecognized NEXT_PUBLIC_STELLAR_NETWORK "${raw}" — expected one of: ${Object.keys(NETWORKS).join(", ")}`
  );
}

export const ACTIVE_NETWORK = resolveNetwork(process.env.NEXT_PUBLIC_STELLAR_NETWORK);

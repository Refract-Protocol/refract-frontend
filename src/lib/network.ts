/**
 * Centralized network/contract config. Refract only runs on Stellar testnet
 * right now (see refract-backend's .env.example), so testnet is the default;
 * set NEXT_PUBLIC_STELLAR_NETWORK=public once there's a mainnet deploy.
 *
 * Contract addresses come from NEXT_PUBLIC_*_CONTRACT_ID env vars so each
 * environment shows the contracts it actually talks to.
 */
export type StellarNetwork = "testnet" | "public";

export const STELLAR_NETWORK: StellarNetwork =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public" ? "public" : "testnet";

export const NETWORK_LABEL: Record<StellarNetwork, string> = {
  testnet: "Stellar Testnet",
  public: "Stellar Mainnet",
};

export const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ??
  (STELLAR_NETWORK === "public" ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org");

export interface ContractInfo {
  name: string;
  description: string;
  /** Soroban contract address (C...), or null if not configured for this environment. */
  address: string | null;
}

export const CONTRACTS: ContractInfo[] = [
  {
    name: "Liquidity pool",
    description: "Holds provider capital, mints PPS shares, and pays out triggered claims.",
    address: process.env.NEXT_PUBLIC_POOL_CONTRACT_ID || null,
  },
  {
    name: "Policy registry",
    description: "Records every purchased policy, its coverage terms, and expiry.",
    address: process.env.NEXT_PUBLIC_POLICY_CONTRACT_ID || null,
  },
  {
    name: "Oracle relay",
    description: "Receives oracle readings that decide whether a policy's trigger has fired.",
    address: process.env.NEXT_PUBLIC_ORACLE_CONTRACT_ID || null,
  },
];

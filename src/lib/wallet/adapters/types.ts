export type WalletAdapterId = "freighter" | "xbull";

export interface WalletNetworkInfo {
  network: string;
  networkPassphrase: string;
}

/** Unified surface every supported Stellar wallet implements. Methods throw on failure. */
export interface WalletAdapter {
  id: WalletAdapterId;
  name: string;
  installUrl: string;
  /** True when the wallet is detectable in this browser. */
  isAvailable(): boolean;
  /** Interactive connect; resolves with the public key. */
  connect(): Promise<string>;
  /** Silent check (no popup): the already-authorized address, or null. Used for rehydration and idle re-confirmation. */
  getAddress(): Promise<string | null>;
  getNetwork(): Promise<WalletNetworkInfo>;
  /** Resolves with the signed XDR. */
  signTransaction(txXdr: string, opts: { networkPassphrase: string; address: string }): Promise<string>;
}

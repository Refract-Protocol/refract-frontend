import { getAddress, getNetwork, isConnected, isAllowed, requestAccess, signTransaction } from "@stellar/freighter-api";
import type { WalletAdapter } from "./types";

export const freighterAdapter: WalletAdapter = {
  id: "freighter",
  name: "Freighter",
  installUrl: "https://www.freighter.app/",
  isAvailable: () => typeof window !== "undefined" && Boolean(window.freighterApi),
  async connect() {
    const { address, error } = await requestAccess();
    if (error || !address) throw new Error(error?.message ?? "Connection was declined");
    return address;
  },
  async getAddress() {
    const { isConnected: connected } = await isConnected();
    if (!connected) return null;
    const { isAllowed: allowed } = await isAllowed();
    if (!allowed) return null;
    const { address, error } = await getAddress();
    return error || !address ? null : address;
  },
  async getNetwork() {
    const { network, networkPassphrase } = await getNetwork();
    return { network, networkPassphrase };
  },
  async signTransaction(txXdr, { networkPassphrase, address }) {
    const { signedTxXdr, error } = await signTransaction(txXdr, { networkPassphrase, address });
    if (error || !signedTxXdr) throw new Error(error?.message ?? "Transaction signing was declined");
    return signedTxXdr;
  },
};

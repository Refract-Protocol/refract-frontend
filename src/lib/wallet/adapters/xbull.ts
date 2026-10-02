import { ACTIVE_NETWORK } from "@/lib/network";
import type { WalletAdapter } from "./types";

/** Subset of the API the xBull browser extension injects as `window.xBullSDK`. */
interface XBullSDK {
  connect(perms: { canRequestPublicKey: boolean; canRequestSign: boolean }): Promise<unknown>;
  getPublicKey(): Promise<string>;
  signXDR(xdr: string, opts: { publicKey: string; network: string }): Promise<string>;
}

function sdk(): XBullSDK | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as { xBullSDK?: XBullSDK }).xBullSDK;
}

function requireSdk(): XBullSDK {
  const s = sdk();
  if (!s) throw new Error("xBull extension not detected");
  return s;
}

export const xbullAdapter: WalletAdapter = {
  id: "xbull",
  name: "xBull",
  installUrl: "https://xbull.app/",
  isAvailable: () => Boolean(sdk()),
  async connect() {
    const s = requireSdk();
    await s.connect({ canRequestPublicKey: true, canRequestSign: true });
    const address = await s.getPublicKey();
    if (!address) throw new Error("Connection was declined");
    return address;
  },
  async getAddress() {
    const s = sdk();
    if (!s) return null;
    try {
      return (await s.getPublicKey()) || null;
    } catch {
      return null;
    }
  },
  async getNetwork() {
    // xBull signs for whichever network the call names; it has no separate "current network" query.
    return { network: ACTIVE_NETWORK.id.toUpperCase(), networkPassphrase: ACTIVE_NETWORK.networkPassphrase };
  },
  async signTransaction(txXdr, { networkPassphrase, address }) {
    const signed = await requireSdk().signXDR(txXdr, { publicKey: address, network: networkPassphrase });
    if (!signed) throw new Error("Transaction signing was declined");
    return signed;
  },
};

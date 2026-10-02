import { freighterAdapter } from "./freighter";
import { xbullAdapter } from "./xbull";
import type { WalletAdapter, WalletAdapterId } from "./types";

export type { WalletAdapter, WalletAdapterId, WalletNetworkInfo } from "./types";

export const WALLET_ADAPTERS: readonly WalletAdapter[] = [freighterAdapter, xbullAdapter];

export function getAdapter(id: WalletAdapterId): WalletAdapter {
  return WALLET_ADAPTERS.find((a) => a.id === id) ?? freighterAdapter;
}

let active: WalletAdapter = freighterAdapter;

/** The adapter signAndSubmit signs with; kept in sync by WalletProvider. */
export function setActiveAdapter(id: WalletAdapterId): void {
  active = getAdapter(id);
}

export function getActiveAdapter(): WalletAdapter {
  return active;
}

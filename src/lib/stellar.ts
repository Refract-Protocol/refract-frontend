import { STELLAR_NETWORK } from "./network";

const EXPLORER_BASE = `https://stellar.expert/explorer/${STELLAR_NETWORK}`;

export function stellarExpertTxUrl(txHash: string): string {
  return `${EXPLORER_BASE}/tx/${txHash}`;
}

export function stellarExpertContractUrl(address: string): string {
  return `${EXPLORER_BASE}/contract/${address}`;
}

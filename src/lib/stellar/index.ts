import { ACTIVE_NETWORK } from "@/lib/network";

/** Explorer link for a transaction on the active network (see src/lib/network.ts). */
export function stellarExpertTxUrl(txHash: string): string {
  return `${ACTIVE_NETWORK.explorerBaseUrl}/tx/${txHash}`;
}

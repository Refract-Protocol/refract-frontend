import { signTransaction } from "@stellar/freighter-api";
import { submitSignedTx } from "@/lib/api/tx";

/**
 * Completes the flow the backend's unsigned txXdr responses (buy/provide/
 * withdraw) start: prompts Freighter to sign, then submits the signed
 * envelope to the backend's /tx/submit, which posts it to Soroban RPC and
 * polls for confirmation. Throws on either a declined signature or a
 * submission that never confirms — callers should only report success once
 * this resolves.
 */
export async function signAndSubmit(txXdr: string, address: string, networkPassphrase: string): Promise<string> {
  const { signedTxXdr, error: signError } = await signTransaction(txXdr, { networkPassphrase, address });
  if (signError || !signedTxXdr) {
    throw new Error(signError?.message ?? "Transaction signing was declined");
  }

  const result = await submitSignedTx(signedTxXdr);
  if (!result.confirmed) {
    throw new Error(result.error ?? "Transaction did not confirm on-chain");
  }
  return result.txHash;
}

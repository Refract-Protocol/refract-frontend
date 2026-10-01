import { signTransaction } from "@stellar/freighter-api";
import { submitSignedTx } from "@/lib/api/tx";

/**
 * Thrown when a signed transaction was submitted but never confirmed. It may
 * still land on-chain, so callers must not blindly rebuild and resubmit it.
 */
export class TxNotConfirmedError extends Error {
  constructor(message: string, readonly txHash: string) {
    super(message);
    this.name = "TxNotConfirmedError";
  }
}

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
    throw new TxNotConfirmedError(result.error ?? "Transaction did not confirm on-chain", result.txHash);
  }
  return result.txHash;
}


import { signTransaction } from "@stellar/freighter-api";
import { submitSignedTx } from "@/lib/api/tx";
import { savePendingTx, getPendingTx, clearPendingTx, type PendingTxKind } from "@/lib/wallet/pendingTxStore";

/**
 * Completes the flow the backend's unsigned txXdr responses (buy/provide/
 * withdraw) start: prompts Freighter to sign, then submits the signed
 * envelope to the backend's /tx/submit, which posts it to Soroban RPC and
 * polls for confirmation. Throws on either a declined signature or a
 * submission that never confirms — callers should only report success once
 * this resolves.
 */
export async function signAndSubmit(
  txXdr: string,
  address: string,
  networkPassphrase: string,
  kind: PendingTxKind = "buy",
): Promise<string> {
  const { signedTxXdr, error: signError } = await signTransaction(txXdr, { networkPassphrase, address });
  if (signError || !signedTxXdr) {
    throw new Error(signError?.message ?? "Transaction signing was declined");
  }

  savePendingTx({ signedXdr: signedTxXdr, kind, submittedAt: Date.now() });
  try {
    const result = await submitSignedTx(signedTxXdr);
    if (!result.confirmed) {
      throw new Error(result.error ?? "Transaction did not confirm on-chain");
    }
    return result.txHash;
  } finally {
    clearPendingTx();
  }
}

/**
 * Best-effort recovery for a transaction that was signed but whose
 * confirmation was never observed (e.g. the tab was refreshed mid-flight).
 * Called once on app startup; resubmission relies on the backend's
 * /tx/submit being idempotent for an already-broadcast envelope.
 */
export async function resolvePendingTx(): Promise<void> {
  const pending = getPendingTx();
  if (!pending) return;

  try {
    await submitSignedTx(pending.signedXdr);
  } catch {
    // Best-effort — nothing more we can do without a richer status API.
  } finally {
    clearPendingTx();
  }
}

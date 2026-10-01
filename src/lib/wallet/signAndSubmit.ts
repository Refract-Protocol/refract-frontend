import { submitSignedTx, type SubmitTxResult } from "@/lib/api/tx";
import { getActiveAdapter } from "./adapters";
import { clearPendingTx, getPendingTx, savePendingTx, type PendingTxKind } from "./pendingTxStore";

/**
 * Thrown when a signed transaction was submitted but never confirmed. It may
 * still land on-chain, so callers must not blindly rebuild and resubmit it.
 */
export class TxNotConfirmedError extends Error {
  constructor(
    message: string,
    readonly txHash: string
  ) {
    super(message);
    this.name = "TxNotConfirmedError";
  }
}

export interface SignOptions {
  /** Signing happens on a hardware wallet (UX hint only). */
  hardware?: boolean;
  /** Persisted so a refresh mid-submission can be reconciled by `resolvePendingTx`. */
  kind?: PendingTxKind;
  /** Called with the signed XDR once the wallet has signed, before submission. */
  onSigned?: (signedXdr: string) => void;
}

/** Third-argument forms: options object, a pending-tx kind, or an `onSigned` callback. */
export type SignOptionsArg = SignOptions | PendingTxKind | ((signedXdr: string) => void);

const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function normalize(arg?: SignOptionsArg): SignOptions {
  if (!arg) return {};
  if (typeof arg === "string") return { kind: arg };
  if (typeof arg === "function") return { onSigned: arg };
  return arg;
}

/**
 * Completes the flow the backend's unsigned txXdr responses (buy/provide/
 * withdraw) start: prompts the connected wallet to sign, then submits the
 * signed envelope to the backend's /tx/submit, which posts it to Soroban RPC
 * and polls for confirmation. Throws on either a declined signature or a
 * submission that never confirms — callers should only report success once
 * this resolves.
 */
export async function signAndSubmit(
  txXdr: string,
  address: string,
  networkPassphrase: string,
  options?: SignOptionsArg
): Promise<string> {
  const { kind, onSigned } = normalize(options);
  const signedTxXdr = await getActiveAdapter().signTransaction(txXdr, { networkPassphrase, address });

  if (kind) savePendingTx({ signedXdr: signedTxXdr, kind, submittedAt: Date.now() });
  onSigned?.(signedTxXdr);

  const result = await submitSignedTx(signedTxXdr);
  if (!result.confirmed) {
    throw new TxNotConfirmedError(result.error ?? "Transaction did not confirm on-chain", result.txHash);
  }
  clearPendingTx();
  return result.txHash;
}

/** Re-submits a transaction that was signed but unconfirmed when the page last unloaded. */
export async function resolvePendingTx(): Promise<SubmitTxResult | null> {
  const pending = getPendingTx();
  if (!pending) return null;
  if (Date.now() - pending.submittedAt > PENDING_MAX_AGE_MS) {
    clearPendingTx();
    return null;
  }
  try {
    const result = await submitSignedTx(pending.signedXdr);
    if (result.confirmed) clearPendingTx();
    return result;
  } catch {
    return null;
  }
}

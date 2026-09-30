import { signTransaction } from "@stellar/freighter-api";
import { ApiError, ApiUnreachableError } from "@/lib/api/client";
import { submitSignedTx } from "@/lib/api/tx";
import { retryWithBackoff } from "@/lib/retry";

const SUBMIT_RETRIES = 3;
const SUBMIT_BASE_DELAY_MS = 1_000;

/** The backend accepted the envelope but hadn't seen it confirm yet — worth asking again. */
class PendingConfirmationError extends Error {
  constructor() {
    super("Transaction did not confirm on-chain");
    this.name = "PendingConfirmationError";
  }
}

/**
 * Transient: the request never reached the backend, the gateway/backend was
 * briefly unavailable, or confirmation was still pending. A definitive
 * rejection (`confirmed: false` with an `error`, or any 4xx) is never retried.
 */
function isTransientSubmitError(err: unknown): boolean {
  if (err instanceof ApiUnreachableError || err instanceof PendingConfirmationError) return true;
  return err instanceof ApiError && (err.status === 408 || err.status === 429 || err.status >= 502);
}

/**
 * Re-submitting the same signed envelope is safe on-chain (identical hash,
 * sequence number already consumed after the first success), so a retry can
 * never double-spend. Dedup still keeps concurrent callers from racing.
 */
async function submitWithRetry(signedTxXdr: string): Promise<string> {
  const result = await retryWithBackoff(
    async () => {
      const res = await submitSignedTx(signedTxXdr);
      if (!res.confirmed && !res.error) throw new PendingConfirmationError();
      return res;
    },
    { retries: SUBMIT_RETRIES, baseDelayMs: SUBMIT_BASE_DELAY_MS, isRetryable: isTransientSubmitError }
  );
  if (!result.confirmed) {
    throw new Error(result.error ?? "Transaction did not confirm on-chain");
  }
  return result.txHash;
}

// In-flight work keyed by envelope XDR: a second call for the same unsigned
// tx (double click) or signed envelope joins the first instead of prompting
// or submitting again. Entries are dropped once settled so a later, deliberate
// retry by the user starts fresh.
const inFlightFlows = new Map<string, Promise<string>>();
const inFlightSubmissions = new Map<string, Promise<string>>();

function dedupe(map: Map<string, Promise<string>>, key: string, run: () => Promise<string>): Promise<string> {
  const existing = map.get(key);
  if (existing) return existing;
  const promise = run().finally(() => map.delete(key));
  map.set(key, promise);
  return promise;
}

/**
 * Completes the flow the backend's unsigned txXdr responses (buy/provide/
 * withdraw) start: prompts Freighter to sign, then submits the signed
 * envelope to the backend's /tx/submit, which posts it to Soroban RPC and
 * polls for confirmation. Transient submission failures are retried with
 * backoff; throws on a declined signature, a definitive rejection, or once
 * retries are exhausted — callers should only report success once this resolves.
 */
export function signAndSubmit(txXdr: string, address: string, networkPassphrase: string): Promise<string> {
  return dedupe(inFlightFlows, txXdr, async () => {
    const { signedTxXdr, error: signError } = await signTransaction(txXdr, { networkPassphrase, address });
    if (signError || !signedTxXdr) {
      throw new Error(signError?.message ?? "Transaction signing was declined");
    }
    return dedupe(inFlightSubmissions, signedTxXdr, () => submitWithRetry(signedTxXdr));
  });
}

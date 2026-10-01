import { Address, FeeBumpTransaction, TransactionBuilder, scValToNative, type Transaction } from "@stellar/stellar-sdk";

type Operation = Transaction["operations"][number];

export interface DecodedOperation {
  /** Stellar operation type, e.g. "invokeHostFunction" or "payment". */
  type: string;
  /** Soroban contract id, for contract calls. */
  contractId?: string;
  /** Contract function name, for contract calls. */
  functionName?: string;
  /** Destination account, for classic payments. */
  destination?: string;
  /** Integer amounts found in the operation, in base units (stroops). */
  amounts: bigint[];
}

export interface TransactionSummary {
  source: string;
  /** Max fee in stroops the envelope declares. */
  feeStroops: bigint;
  operations: DecodedOperation[];
}

/**
 * Decodes an unsigned transaction envelope into a human-readable summary so
 * the user can review what they're about to sign. Pure and side-effect free.
 * Returns null when the XDR can't be parsed or holds an operation shape this
 * decoder doesn't understand — callers should then fall back to a generic
 * "review in your wallet" notice rather than showing partial data.
 */
export function decodeTransactionSummary(txXdr: string, networkPassphrase: string): TransactionSummary | null {
  try {
    const parsed = TransactionBuilder.fromXDR(txXdr, networkPassphrase);
    const tx = parsed instanceof FeeBumpTransaction ? parsed.innerTransaction : parsed;
    const operations = tx.operations.map(decodeOperation);
    if (operations.length === 0 || operations.some((op) => op === null)) return null;
    return { source: tx.source, feeStroops: BigInt(parsed.fee), operations: operations as DecodedOperation[] };
  } catch {
    return null;
  }
}

function decodeOperation(op: Operation): DecodedOperation | null {
  if (op.type === "invokeHostFunction") {
    const fn = op.func;
    if (fn.type !== "hostFunctionTypeInvokeContract") return null;
    const call = fn.invokeContract;
    const args = call.args.map((a) => scValToNative(a) as unknown);
    return {
      type: op.type,
      contractId: Address.fromScAddress(call.contractAddress).toString(),
      functionName: call.functionName.toString(),
      amounts: args.filter((a): a is bigint => typeof a === "bigint"),
    };
  }
  if (op.type === "payment") {
    return {
      type: op.type,
      destination: op.destination,
      amounts: [BigInt(Math.round(parseFloat(op.amount) * 1e7))],
    };
  }
  return null;
}

/**
 * True when the summary declares amounts but none of them equals the amount
 * the user entered (both in base units). No declared amounts isn't treated
 * as a mismatch — there's simply nothing to cross-check.
 */
export function hasAmountMismatch(summary: TransactionSummary, expectedStroops: string): boolean {
  const amounts = summary.operations.flatMap((op) => op.amounts);
  if (amounts.length === 0) return false;
  const expected = BigInt(expectedStroops);
  return !amounts.includes(expected);
}

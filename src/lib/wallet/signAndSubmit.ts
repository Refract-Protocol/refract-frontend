import { signTransaction } from "@stellar/freighter-api";
import { submitSignedTx } from "@/lib/api/tx";

export type SigningErrorKind =
  | "declined"
  | "hardware_locked"
  | "hardware_wrong_app"
  | "hardware_rejected"
  | "hardware_disconnected"
  | "unknown";

/**
 * Known Ledger failure substrings as surfaced by Freighter's Ledger
 * passthrough (ledgerjs status codes / transport errors). Checked in order.
 */
const HARDWARE_PATTERNS: { kind: SigningErrorKind; pattern: RegExp; message: string }[] = [
  {
    kind: "hardware_locked",
    pattern: /locked|0x5515|0x6b0c|unlock/i,
    message: "Your Ledger is locked — unlock it with your PIN and try again.",
  },
  {
    kind: "hardware_wrong_app",
    pattern: /0x6e00|0x6d00|0x6511|wrong app|app.*not open|open the stellar app|CLA_NOT_SUPPORTED|INS_NOT_SUPPORTED/i,
    message: "Open the Stellar app on your Ledger, then try again.",
  },
  {
    kind: "hardware_rejected",
    pattern: /0x6985|denied by the user|rejected on (the )?device|conditions of use not satisfied/i,
    message: "The transaction was rejected on your Ledger device.",
  },
  {
    kind: "hardware_disconnected",
    pattern: /transport|no device|device not found|disconnected|TransportOpenUserCancelled|timeout/i,
    message: "Couldn't reach your Ledger — check it's plugged in and try again.",
  },
];

export class SigningError extends Error {
  constructor(message: string, public kind: SigningErrorKind, public raw?: string) {
    super(message);
    this.name = "SigningError";
  }
}

/**
 * Maps a raw Freighter signing error to a user-facing message. Ledger-specific
 * copy is only returned when the session is a hardware-wallet session, so
 * software-wallet users keep the generic messaging.
 */
export function classifySigningError(raw: string | undefined, hardware: boolean): SigningError {
  const text = raw ?? "";
  if (hardware) {
    const match = HARDWARE_PATTERNS.find((p) => p.pattern.test(text));
    if (match) return new SigningError(match.message, match.kind, raw);
  }
  if (!text || /declin|reject|denied|cancel/i.test(text)) {
    return new SigningError("Transaction signing was declined", "declined", raw);
  }
  return new SigningError(text, "unknown", raw);
}

interface SignAndSubmitOptions {
  /** True when the user signs via a Ledger through Freighter — enables hardware-specific error copy. */
  hardware?: boolean;
}

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
  opts: SignAndSubmitOptions = {}
): Promise<string> {
  let signedTxXdr: string | undefined;
  try {
    const res = await signTransaction(txXdr, { networkPassphrase, address });
    if (res.error || !res.signedTxXdr) throw classifySigningError(res.error?.message, Boolean(opts.hardware));
    signedTxXdr = res.signedTxXdr;
  } catch (err) {
    if (err instanceof SigningError) throw err;
    throw classifySigningError(err instanceof Error ? err.message : String(err), Boolean(opts.hardware));
  }

  const result = await submitSignedTx(signedTxXdr);
  if (!result.confirmed) {
    throw new Error(result.error ?? "Transaction did not confirm on-chain");
  }
  return result.txHash;
}

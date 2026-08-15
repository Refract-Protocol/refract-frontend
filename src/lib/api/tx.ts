import { apiRequest } from "./client";

/** Mirrors refract-backend/src/stellar/soroban-confirmation.util.ts's ConfirmationResult. */
export interface SubmitTxResult {
  confirmed: boolean;
  txHash: string;
  error?: string;
}

export function submitSignedTx(signedXdr: string): Promise<SubmitTxResult> {
  return apiRequest("/tx/submit", { method: "POST", body: { signedXdr } });
}

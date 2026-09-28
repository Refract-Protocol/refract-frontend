import { apiRequest } from "./client";
import type { ApiSchemas } from "./generated";

/** Types are generated from openapi/refract-api.yaml, which mirrors refract-backend/src/stellar/soroban-confirmation.util.ts's ConfirmationResult. */
export type SubmitTxResult = ApiSchemas["SubmitTxResult"];

export function submitSignedTx(signedXdr: string): Promise<SubmitTxResult> {
  return apiRequest("/tx/submit", { method: "POST", body: { signedXdr } });
}

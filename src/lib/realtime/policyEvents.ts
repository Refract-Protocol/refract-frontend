import { z } from "zod";

/**
 * Payloads published on `policy.<address>` (issue #246).
 *
 * Every event names the policy (`policyId`) and/or the purchase transaction
 * (`txHash`) it belongs to. The REST purchase call is the source of truth for
 * the transaction hash; these events are state transitions for it.
 *
 * Amounts are base-unit USDC strings (1e7 per USDC), like the REST API.
 * `ts` is the server clock (ms since epoch); normalize it before display.
 */

const base = {
  holder: z.string().min(1),
  ts: z.number().int().positive(),
};

/** The backend has seen the purchase transaction and is waiting for it to settle. */
const accepted = z.object({
  ...base,
  type: z.literal("accepted"),
  txHash: z.string().min(1),
  policyId: z.string().min(1).optional(),
});

/** The policy exists on-chain and is active. */
const issued = z.object({
  ...base,
  type: z.literal("issued"),
  policyId: z.string().min(1),
  txHash: z.string().min(1),
  coverageTypeName: z.string().optional(),
  coverageAmount: z.string().optional(),
  premium: z.string().optional(),
  /** Unix seconds. */
  expiresAt: z.number().int().positive().optional(),
});

/** A premium charge for the policy was recorded on-chain. */
const premiumCharged = z.object({
  ...base,
  type: z.literal("premium_charged"),
  policyId: z.string().min(1),
  amount: z.string(),
  txHash: z.string().min(1).optional(),
});

/** The policy was cancelled after issuance. */
const cancelled = z.object({
  ...base,
  type: z.literal("cancelled"),
  policyId: z.string().min(1),
  reason: z.enum(["holder_requested", "pool_insufficient", "expired", "oracle_triggered"]),
  refundAmount: z.string().optional(),
  txHash: z.string().min(1).optional(),
});

/** The purchase failed before the policy was issued (reverted, expired, rejected). */
const failed = z.object({
  ...base,
  type: z.literal("failed"),
  txHash: z.string().min(1),
  policyId: z.string().min(1).optional(),
  reason: z.string(),
});

export const policyEventSchema = z.discriminatedUnion("type", [
  accepted,
  issued,
  premiumCharged,
  cancelled,
  failed,
]);

export type PolicyEvent = z.infer<typeof policyEventSchema>;
export type PolicyEventType = PolicyEvent["type"];

/** Validates a `policy.<address>` payload. Returns null for anything malformed. */
export function parsePolicyEvent(payload: unknown): PolicyEvent | null {
  const result = policyEventSchema.safeParse(payload);
  return result.success ? result.data : null;
}

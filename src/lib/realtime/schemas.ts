import { z } from "zod";

export const SUPPORTED_PROTOCOL_VERSION = 1 as const;

export const oracleReadingSchema = z
  .object({
    coverageType: z.string().min(1),
    type: z.literal("oracle_update"),
    value: z.number().finite(),
    threshold: z.number().finite(),
    severity: z.enum(["low", "medium", "high", "triggered"]),
    message: z.string().min(1),
  })
  .passthrough();

export const claimSettlementSchema = z
  .object({
    policyId: z.string().min(1),
    holder: z.string().min(1),
    coverageType: z.number().int().nonnegative(),
    triggered: z.boolean(),
    payout: z.string().regex(/^\d+$/),
    reason: z.string().min(1),
    processedAt: z.number().int().nonnegative(),
    settlementTxHash: z.string().min(1).optional(),
  })
  .passthrough();

export const poolStatsSchema = z
  .object({
    totalUsdc: z.string().regex(/^\d+$/),
    totalShares: z.string().regex(/^\d+$/),
    lockedUsdc: z.string().regex(/^\d+$/),
    premiumAccrued: z.string().regex(/^\d+$/),
    availableUsdc: z.string().regex(/^\d+$/),
    utilizationBps: z.number().int().min(0).max(10_000),
    apyBps: z.number().int().min(0),
    sharePrice: z.number().positive(),
    maxUtilizationBps: z.number().int().min(0).max(10_000),
  })
  .passthrough();

export const notificationSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      "policy_expiring",
      "claim_payout",
      "lockup_expired",
      "lockup_soon",
      "oracle_trigger",
    ]),
    title: z.string().min(1),
    message: z.string().min(1),
    timestamp: z.number().int().nonnegative(),
    read: z.boolean().optional().default(false),
    href: z.string().min(1).optional(),
    severity: z.enum(["info", "warning", "success", "critical"]),
  })
  .passthrough();

/**
 * Pre-allocated per-topic payload schemas to avoid re-allocating Zod schemas on
 * high-frequency inbound frames. Forward-compatible unknown fields are preserved
 * via `.passthrough()`.
 */
export const INBOUND_TOPIC_SCHEMAS = {
  "oracle.readings": oracleReadingSchema,
  "claims.settlement": claimSettlementSchema,
  "pool.stats": poolStatsSchema,
  notifications: notificationSchema,
} as const;

export type ValidatedTopicName = keyof typeof INBOUND_TOPIC_SCHEMAS;

export type ValidatedTopicPayloads = {
  "oracle.readings": z.infer<typeof oracleReadingSchema>;
  "claims.settlement": z.infer<typeof claimSettlementSchema>;
  "pool.stats": z.infer<typeof poolStatsSchema>;
  notifications: z.infer<typeof notificationSchema>;
};

export const inboundEnvelopeBaseSchema = z
  .object({
    v: z.number().int().optional(),
    id: z.string().min(1).optional(),
    topic: z.string().min(1),
    type: z.enum(["snapshot", "delta", "event"]).optional(),
    seq: z.number().int().nonnegative().optional(),
    ts: z.number().int().positive().optional(),
    payload: z.unknown(),
  })
  .passthrough();

export type InboundEnvelopeBase = z.infer<typeof inboundEnvelopeBaseSchema>;

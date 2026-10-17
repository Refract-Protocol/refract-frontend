import { z } from "zod";

export const REALTIME_PROTOCOL_VERSION = 1 as const;
export const MAX_REALTIME_FRAME_BYTES = 64 * 1024;

export const REALTIME_TOPICS = [
  "oracle.readings",
  "claims.settlement",
  "pool.stats",
  "notifications",
] as const;

export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

export type DeliveryGuarantee = "at-least-once-ordered" | "best-effort-latest";
export type TransportPreference = "websocket" | "sse";

export interface TopicMetadata {
  topic: RealtimeTopic;
  flagName: string;
  primaryTransport: TransportPreference;
  fallbackTransport: TransportPreference;
  delivery: DeliveryGuarantee;
  dedupKeyFields: readonly string[];
  description: string;
}

export const TOPIC_METADATA: Record<RealtimeTopic, TopicMetadata> = {
  "oracle.readings": {
    topic: "oracle.readings",
    flagName: "realtime-oracle",
    primaryTransport: "websocket",
    fallbackTransport: "sse",
    delivery: "best-effort-latest",
    dedupKeyFields: ["coverageType", "ts", "seq"],
    description: "Live oracle risk readings and threshold trigger state per coverage type.",
  },
  "claims.settlement": {
    topic: "claims.settlement",
    flagName: "realtime-claims",
    primaryTransport: "websocket",
    fallbackTransport: "sse",
    delivery: "at-least-once-ordered",
    dedupKeyFields: ["policyId", "processedAt"],
    description: "Claim evaluation and on-chain payout settlement events.",
  },
  "pool.stats": {
    topic: "pool.stats",
    flagName: "realtime-pool",
    primaryTransport: "websocket",
    fallbackTransport: "sse",
    delivery: "best-effort-latest",
    dedupKeyFields: ["seq", "ts"],
    description: "Aggregated liquidity pool TVL, utilization, APY, and share price snapshots.",
  },
  notifications: {
    topic: "notifications",
    flagName: "realtime-notifications",
    primaryTransport: "websocket",
    fallbackTransport: "sse",
    delivery: "at-least-once-ordered",
    dedupKeyFields: ["id"],
    description: "Wallet-scoped and protocol-wide user alerts (policy expiry, payouts, lockups, triggers).",
  },
};

export const oracleReadingPayloadSchema = z
  .object({
    coverageType: z.string().min(1),
    type: z.literal("oracle_update"),
    value: z.number().finite(),
    threshold: z.number().finite(),
    severity: z.enum(["low", "medium", "high", "triggered"]),
    message: z.string().min(1),
  })
  .passthrough();

export const claimSettlementPayloadSchema = z
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

export const poolStatsPayloadSchema = z
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

export const notificationPayloadSchema = z
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
    walletAddress: z.string().min(1).optional(),
  })
  .passthrough();

export const TOPIC_PAYLOAD_SCHEMAS = {
  "oracle.readings": oracleReadingPayloadSchema,
  "claims.settlement": claimSettlementPayloadSchema,
  "pool.stats": poolStatsPayloadSchema,
  notifications: notificationPayloadSchema,
} as const;

export type TopicPayloadMap = {
  "oracle.readings": z.infer<typeof oracleReadingPayloadSchema>;
  "claims.settlement": z.infer<typeof claimSettlementPayloadSchema>;
  "pool.stats": z.infer<typeof poolStatsPayloadSchema>;
  notifications: z.infer<typeof notificationPayloadSchema>;
};

const baseEnvelopeFields = {
  v: z.literal(REALTIME_PROTOCOL_VERSION),
  id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  ts: z.number().int().positive(),
};

export const oracleReadingsEnvelopeSchema = z
  .object({
    ...baseEnvelopeFields,
    topic: z.literal("oracle.readings"),
    type: z.enum(["snapshot", "delta"]),
    payload: oracleReadingPayloadSchema,
  })
  .passthrough();

export const claimsSettlementEnvelopeSchema = z
  .object({
    ...baseEnvelopeFields,
    topic: z.literal("claims.settlement"),
    type: z.enum(["snapshot", "event"]),
    payload: claimSettlementPayloadSchema,
  })
  .passthrough();

export const poolStatsEnvelopeSchema = z
  .object({
    ...baseEnvelopeFields,
    topic: z.literal("pool.stats"),
    type: z.enum(["snapshot", "delta"]),
    payload: poolStatsPayloadSchema,
  })
  .passthrough();

export const notificationsEnvelopeSchema = z
  .object({
    ...baseEnvelopeFields,
    topic: z.literal("notifications"),
    type: z.enum(["snapshot", "event"]),
    payload: notificationPayloadSchema,
  })
  .passthrough();

export const realtimeTopicEnvelopeSchema = z.discriminatedUnion("topic", [
  oracleReadingsEnvelopeSchema,
  claimsSettlementEnvelopeSchema,
  poolStatsEnvelopeSchema,
  notificationsEnvelopeSchema,
]);

export const subscribeControlFrameSchema = z
  .object({
    v: z.literal(REALTIME_PROTOCOL_VERSION),
    type: z.literal("subscribe"),
    id: z.string().min(1),
    ts: z.number().int().positive(),
    topics: z.array(z.enum(REALTIME_TOPICS)).min(1),
    cursor: z.record(z.string(), z.number().int().nonnegative()).optional(),
    auth: z
      .object({
        walletAddress: z.string().min(1),
        token: z.string().min(1),
      })
      .optional(),
  })
  .passthrough();

export const unsubscribeControlFrameSchema = z
  .object({
    v: z.literal(REALTIME_PROTOCOL_VERSION),
    type: z.literal("unsubscribe"),
    id: z.string().min(1),
    ts: z.number().int().positive(),
    topics: z.array(z.enum(REALTIME_TOPICS)).min(1),
  })
  .passthrough();

export const heartbeatPingFrameSchema = z
  .object({
    v: z.literal(REALTIME_PROTOCOL_VERSION),
    type: z.literal("ping"),
    id: z.string().min(1),
    ts: z.number().int().positive(),
  })
  .passthrough();

export const heartbeatPongFrameSchema = z
  .object({
    v: z.literal(REALTIME_PROTOCOL_VERSION),
    type: z.literal("pong"),
    id: z.string().min(1),
    ts: z.number().int().positive(),
    serverTs: z.number().int().positive(),
  })
  .passthrough();

export const resumeAckFrameSchema = z
  .object({
    v: z.literal(REALTIME_PROTOCOL_VERSION),
    type: z.literal("resume_ack"),
    id: z.string().min(1),
    ts: z.number().int().positive(),
    topic: z.enum(REALTIME_TOPICS),
    mode: z.enum(["replayed", "resync_required"]),
    fromSeq: z.number().int().nonnegative(),
    latestSeq: z.number().int().nonnegative(),
  })
  .passthrough();

export const errorFrameSchema = z
  .object({
    v: z.literal(REALTIME_PROTOCOL_VERSION),
    type: z.literal("error"),
    id: z.string().min(1),
    ts: z.number().int().positive(),
    code: z.enum([
      "UNAUTHORIZED",
      "TOKEN_EXPIRED",
      "UNKNOWN_TOPIC",
      "VERSION_MISMATCH",
      "RATE_LIMITED",
      "BACKPRESSURE_DROP",
      "PAYLOAD_TOO_LARGE",
      "INTERNAL_ERROR",
    ]),
    message: z.string().min(1),
    topic: z.enum(REALTIME_TOPICS).optional(),
    retryAfterMs: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const realtimeFrameSchema = z.union([
  realtimeTopicEnvelopeSchema,
  subscribeControlFrameSchema,
  unsubscribeControlFrameSchema,
  heartbeatPingFrameSchema,
  heartbeatPongFrameSchema,
  resumeAckFrameSchema,
  errorFrameSchema,
]);

export type RealtimeTopicEnvelope = z.infer<typeof realtimeTopicEnvelopeSchema>;
export type RealtimeFrame = z.infer<typeof realtimeFrameSchema>;

/**
 * Derives a deterministic idempotency/deduplication key for a validated topic envelope.
 */
export function getEnvelopeDedupKey(envelope: RealtimeTopicEnvelope): string {
  switch (envelope.topic) {
    case "oracle.readings":
      return `oracle.readings:${envelope.payload.coverageType}:${envelope.seq}`;
    case "claims.settlement":
      return `claims.settlement:${envelope.payload.policyId}:${envelope.payload.processedAt}`;
    case "pool.stats":
      return `pool.stats:${envelope.seq}`;
    case "notifications":
      return `notifications:${envelope.payload.id}`;
  }
}

/**
 * Machine-readable JSON Schema (Draft 2020-12) companion for the Realtime Protocol v1.
 */
export const REALTIME_PROTOCOL_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://refract.protocol/schemas/realtime-protocol-v1.json",
  title: "Refract Realtime Protocol v1",
  type: "object",
  required: ["v", "type", "id", "ts"],
  properties: {
    v: { const: REALTIME_PROTOCOL_VERSION },
    id: { type: "string", minLength: 1 },
    ts: { type: "integer", minimum: 1 },
    seq: { type: "integer", minimum: 0 },
    topic: { enum: [...REALTIME_TOPICS] },
    type: {
      enum: [
        "snapshot",
        "delta",
        "event",
        "subscribe",
        "unsubscribe",
        "ping",
        "pong",
        "resume_ack",
        "error",
      ],
    },
  },
  additionalProperties: true,
} as const;

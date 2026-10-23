import { z } from "zod";

/** Realtime topic string identifiers pushed by the backend. */
export const REALTIME_TOPICS = {
  /** Oracle price/threshold update for a coverage type. */
  oracleUpdate: "oracle_update",
  /** A claim was settled (payout disbursed). */
  claimSettled: "claim_settled",
  /** Pool stats changed (TVL, utilization, APY). */
  poolStatsUpdate: "pool_stats_update",
  /** A new policy was issued. */
  policyIssued: "policy_issued",
} as const;

export type RealtimeTopic = (typeof REALTIME_TOPICS)[keyof typeof REALTIME_TOPICS];
export type KnownTopic = RealtimeTopic | "pool_stats";

/** Frames larger than this are rejected without parsing. */
export const MAX_FRAME_BYTES = 256 * 1024;

const topicSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9_.:-]+$/i, "invalid topic name");

export const dataEventSchema = z.object({
  topic: topicSchema,
  id: z.string().trim().min(1).max(256).optional(),
  seq: z.number().int().nonnegative().optional(),
  payload: z.unknown(),
});

export const controlFrameSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscribed"),
    topics: z.array(topicSchema),
    /** Topics whose resume cursor fell outside the server's replay window. */
    gap: z.array(topicSchema).optional(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string().optional(),
  }),
  z.object({ type: z.literal("ping") }),
]);

export type DataEvent = z.infer<typeof dataEventSchema>;
export type ControlFrame = z.infer<typeof controlFrameSchema>;

export type RealtimeMessage =
  ({ kind: "event" } & DataEvent) | ({ kind: "control" } & ControlFrame);

/** Per-topic resume cursor: last `seq` the client applied for each topic. */
export type Cursors = Record<string, number>;

/** Client → server messages (WebSocket only; SSE/long-poll encode these as query params). */
export type ClientMessage =
  | { type: "subscribe"; topics: string[]; cursors?: Cursors }
  | { type: "unsubscribe"; topics: string[] }
  | { type: "pong" };

/** Error codes the server uses to signal that reconnecting will not help. */
export const AUTH_ERROR_CODES = new Set(["auth_failed", "unauthorized", "forbidden"]);

/** WebSocket close codes the client treats as an auth rejection (no retry). */
export const AUTH_CLOSE_CODES = new Set([4401, 4403]);

/** Encodes cursors for query-string transports, e.g. `oracle_update:41,pool_stats:7`. */
export function encodeCursors(cursors: Cursors): string {
  return Object.entries(cursors)
    .map(([topic, seq]) => `${topic}:${seq}`)
    .join(",");
}

export function decodeCursors(raw: string | null | undefined): Cursors {
  const out: Cursors = {};
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const idx = part.lastIndexOf(":");
    if (idx <= 0) continue;
    const seq = Number(part.slice(idx + 1));
    if (Number.isInteger(seq) && seq >= 0) out[part.slice(0, idx)] = seq;
  }
  return out;
}

/**
 * Per-topic ring-buffer capacity. These caps bound memory usage during long
 * sessions — see `RealtimeClient` which creates one `RingBuffer` per topic.
 */
export const TOPIC_BUFFER_CAPS: Record<RealtimeTopic, number> = {
  [REALTIME_TOPICS.oracleUpdate]: 100,
  [REALTIME_TOPICS.claimSettled]: 50,
  [REALTIME_TOPICS.poolStatsUpdate]: 50,
  [REALTIME_TOPICS.policyIssued]: 50,
} as const;

export const TOPIC_TO_QUERY_KEYS: Record<RealtimeTopic, readonly (readonly string[])[]> = {
  [REALTIME_TOPICS.oracleUpdate]: [["oracle"]] as const,
  [REALTIME_TOPICS.claimSettled]: [
    ["claims"],
    ["claimStats"],
  ] as const,
  [REALTIME_TOPICS.poolStatsUpdate]: [
    ["poolStats"],
    ["poolAllocation"],
  ] as const,
  [REALTIME_TOPICS.policyIssued]: [
    ["policies"],
    ["holderPolicies"],
  ] as const,
} as const;

export const TOPIC_ANNOUNCEMENTS: Record<RealtimeTopic, string> = {
  [REALTIME_TOPICS.oracleUpdate]: "Oracle reading updated",
  [REALTIME_TOPICS.claimSettled]: "Claim settled",
  [REALTIME_TOPICS.poolStatsUpdate]: "Pool statistics updated",
  [REALTIME_TOPICS.policyIssued]: "Policy issued",
} as const;

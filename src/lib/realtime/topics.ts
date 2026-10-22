import { z } from "zod";

/**
 * Realtime topic/message contract shared by every transport (WebSocket, SSE,
 * long-poll). The backend is expected to implement exactly this shape; the
 * client validates every inbound frame against it before fan-out.
 *
 * Server → client frames are one of:
 *   - a data event:  { topic, id, seq, payload }
 *   - a control frame: { type: "subscribed" | "error" | "ping", ... }
 *
 * `id` is a stable, globally unique event id used for de-duplication.
 * `seq` is a per-topic monotonic sequence number used as the resume cursor.
 * Both are required by the contract, but a frame missing `id` is tolerated
 * (passed through without de-duplication and counted) so a misbehaving
 * producer degrades observability rather than dropping data.
 */

export const REALTIME_TOPICS = ["oracle_update", "claim_settled", "pool_stats"] as const;
export type KnownTopic = (typeof REALTIME_TOPICS)[number];

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

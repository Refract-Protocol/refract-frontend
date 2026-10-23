import { z } from "zod";

/**
 * Runtime schemas for inbound realtime frames.
 *
 * These are co-located with the realtime contract so that the transport
 * boundary can validate every frame once, and every downstream consumer
 * (registry, merge layer, hooks) can assume valid, typed data.
 *
 * Forward-compat policy: unknown extra fields on payloads are stripped
 * (not rejected) so the backend can add fields without breaking clients.
 * Unknown topics are rejected. A protocol version mismatch (major) marks
 * the transport incompatible rather than delivering frames.
 */

export const PROTOCOL_VERSION = 1;

/** Envelope shared by every inbound frame. */
export const envelopeSchema = z.object({
  topic: z.string().min(1),
  version: z.number().int().nonnegative().optional(),
  payload: z.unknown(),
});

export type Envelope = z.infer<typeof envelopeSchema>;

/** Per-topic payload schemas. */
export const topicPayloadSchemas = {
  oracle_update: z
    .object({
      asset: z.string().min(1),
      price: z.number().finite(),
      timestamp: z.number().finite(),
    })
    .passthrough(),
} as const;

export type RealtimeTopic = keyof typeof topicPayloadSchemas;

export type TopicPayload<T extends RealtimeTopic> = z.infer<
  (typeof topicPayloadSchemas)[T]
>;

/**
 * Result of parsing a raw inbound frame.
 * - `ok`: validated frame ready for dispatch.
 * - `invalid`: malformed payload; drop and count.
 * - `incompatible`: protocol version mismatch; mark transport incompatible.
 */
export type ParseResult =
  | { status: "ok"; topic: RealtimeTopic; payload: unknown }
  | { status: "invalid"; reason: string }
  | { status: "incompatible"; reason: string };

function isKnownTopic(topic: string): topic is RealtimeTopic {
  return Object.prototype.hasOwnProperty.call(topicPayloadSchemas, topic);
}

/**
 * Parse and validate a raw inbound frame. Cheap: schemas are module-level
 * constants, never re-allocated per message.
 */
export function parseInboundFrame(raw: unknown): ParseResult {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return { status: "invalid", reason: "malformed envelope" };
  }

  const { topic, version, payload } = envelope.data;

  if (version !== undefined && version !== PROTOCOL_VERSION) {
    return {
      status: "incompatible",
      reason: `protocol version ${version} != ${PROTOCOL_VERSION}`,
    };
  }

  if (!isKnownTopic(topic)) {
    return { status: "invalid", reason: `unknown topic "${topic}"` };
  }

  const payloadSchema = topicPayloadSchemas[topic];
  const parsedPayload = payloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return { status: "invalid", reason: `invalid payload for "${topic}"` };
  }

  return { status: "ok", topic, payload: parsedPayload.data };
}

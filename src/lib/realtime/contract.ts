/**
 * Consumer-driven realtime topic/message contract & topic scheduling contract.
 */

import { z } from "zod";

/** Semver string of the backend contract revision this frontend targets. */
export const CONTRACT_VERSION = "0.1.0";

/**
 * `oracle_update` — pushed whenever an oracle check completes on the backend.
 * Shape mirrors `OracleReading` in `openapi/refract-api.yaml` / `schema.d.ts`.
 */
export const oracleUpdateSchema = z.object({
  coverageType: z.string().min(1),
  type: z.literal("oracle_update"),
  value: z.number(),
  threshold: z.number(),
  severity: z.enum(["low", "medium", "high", "triggered"]),
  message: z.string(),
});

export type OracleUpdatePayload = z.infer<typeof oracleUpdateSchema>;

/**
 * The outer envelope for every frame received from the WebSocket.
 * Inner payload validation is done per-topic via `TOPIC_SCHEMAS`.
 */
export const envelopeSchema = z.object({
  topic: z.string().min(1),
  payload: z.unknown(),
});

export type Envelope = z.infer<typeof envelopeSchema>;

/** All topics the frontend currently subscribes to, with their validators. */
export const TOPIC_SCHEMAS: Record<string, z.ZodTypeAny> = {
  oracle_update: oracleUpdateSchema,
};

/** Names of all known topics (derived from TOPIC_SCHEMAS for DRYness). */
export const KNOWN_TOPICS: ReadonlyArray<string> = Object.keys(TOPIC_SCHEMAS);

export interface ValidationResult {
  ok: boolean;
  topic: string;
  errors?: z.ZodIssue[];
}

export function validateFrame(topic: string, payload: unknown): ValidationResult {
  const schema = TOPIC_SCHEMAS[topic];
  if (!schema) return { ok: true, topic };

  const result = schema.safeParse(payload);
  if (result.success) return { ok: true, topic };
  return { ok: false, topic, errors: result.error.issues };
}

export function assertFrame(topic: string, payload: unknown): void {
  const result = validateFrame(topic, payload);
  if (!result.ok) {
    throw new ContractViolationError(topic, result.errors ?? []);
  }
}

export class ContractViolationError extends Error {
  constructor(
    public readonly topic: string,
    public readonly issues: z.ZodIssue[]
  ) {
    const summary = issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    super(`Contract violation for topic "${topic}":\n${summary}`);
    this.name = "ContractViolationError";
  }
}

export function diffOpenApiSchema(
  openApiProperties: Record<string, unknown>,
  zodSchema: z.ZodObject<z.ZodRawShape>
): { missingInZod: string[]; missingInOpenApi: string[] } {
  const openApiKeys = new Set(Object.keys(openApiProperties));
  const zodKeys = new Set(Object.keys(zodSchema.shape));

  const missingInZod = [...openApiKeys].filter((k) => !zodKeys.has(k));
  const missingInOpenApi = [...zodKeys].filter((k) => !openApiKeys.has(k));

  return { missingInZod, missingInOpenApi };
}

/** Every supported topic has an explicit scheduling class. Unknown topics are rejected. */
export const TOPICS = {
  claim_settlement: "critical",
  transaction_confirmation: "critical",
  auth: "critical",
  control: "critical",
  oracle_update: "bulk",
  pool_stats: "bulk",
  activity_feed: "bulk",
} as const;
export type Topic = keyof typeof TOPICS;
export type Priority = (typeof TOPICS)[Topic];
export interface Message {
  topic: Topic;
  payload: unknown;
  entityId?: string;
  version?: number;
  timestamp?: number;
}
export interface Interest {
  entityIds?: string[];
  minVersion?: number;
  minTimestamp?: number;
  fields?: string[];
  broad?: boolean;
}
export interface Descriptor {
  topic: Topic;
  interest: Interest;
}
export function validateMessage(value: unknown): Message {
  if (!value || typeof value !== "object") throw new Error("Invalid envelope");
  const m = value as Message;
  if (
    !Object.hasOwn(TOPICS, m.topic) ||
    !("payload" in m) ||
    (m.entityId !== undefined && typeof m.entityId !== "string") ||
    (m.version !== undefined && (!Number.isFinite(m.version) || m.version < 0)) ||
    (m.timestamp !== undefined && !Number.isFinite(m.timestamp))
  )
    throw new Error("Invalid envelope");
  return m;
}
export function descriptor(topic: Topic, interest: Interest): Descriptor {
  if (!Object.hasOwn(TOPICS, topic)) throw new Error("Unknown topic");
  const normalize = (values?: string[]) =>
    values ? [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort() : undefined;
  const entityIds = normalize(interest.entityIds);
  const fields = normalize(interest.fields);
  for (const floor of [interest.minVersion, interest.minTimestamp]) {
    if (floor !== undefined && (!Number.isFinite(floor) || floor < 0))
      throw new Error("Invalid cursor");
  }
  if (
    !interest.broad &&
    !entityIds?.length &&
    !(interest.minVersion !== undefined && interest.minVersion > 0) &&
    !(interest.minTimestamp !== undefined && interest.minTimestamp > 0)
  )
    throw new Error("Explicit broad interest required");
  return {
    topic,
    interest: {
      entityIds: entityIds?.length ? entityIds : undefined,
      minVersion: interest.minVersion,
      minTimestamp: interest.minTimestamp,
      fields: fields?.length ? fields : undefined,
      broad: interest.broad || undefined,
    },
  };
}
export function matches(m: Message, i: Interest): boolean {
  return (
    (!i.entityIds?.length || (m.entityId !== undefined && i.entityIds.includes(m.entityId))) &&
    (i.minVersion === undefined || (m.version !== undefined && m.version >= i.minVersion)) &&
    (i.minTimestamp === undefined || (m.timestamp !== undefined && m.timestamp >= i.minTimestamp))
  );
}

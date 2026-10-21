/**
 * Consumer-driven realtime topic/message contract.
 *
 * Closes #234: Pins the frontend's expectations of the realtime
 * WebSocket topic/message contract to a versioned, machine-checkable artifact
 * so that CI fails when the backend-published schema drifts from what
 * `src/lib/realtime/client.ts` assumes.
 *
 * ## How it works
 *
 * 1. This file defines the *consumer contract* — the exact message shapes and
 *    topic names the frontend relies on — as Zod schemas.
 *
 * 2. `CONTRACT_VERSION` is a semver string pinned to the backend version that
 *    was authoritative when this contract was written. Update it whenever the
 *    shapes change, then update the tests to match.
 *
 * 3. `src/lib/realtime/contract.test.ts` validates every schema against the
 *    corresponding component in `openapi/refract-api.yaml`. CI runs this test
 *    so a backend API drift immediately fails the build.
 *
 * 4. `validateFrame(topic, payload)` can be called at runtime (gated behind
 *    a flag or dev/test mode check) to surface schema violations early.
 *
 * ## Adding a new topic
 *
 * 1. Add a Zod schema below (naming convention: `<topicName>Schema`).
 * 2. Register it in `TOPIC_SCHEMAS`.
 * 3. Add a corresponding component schema in `openapi/refract-api.yaml`.
 * 4. Add a contract test in `contract.test.ts`.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Contract version — bump when backend breaks compatibility
// ---------------------------------------------------------------------------

/** Semver string of the backend contract revision this frontend targets. */
export const CONTRACT_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Per-topic payload schemas
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Envelope schema — the outer { topic, payload } wrapper every WS frame uses
// ---------------------------------------------------------------------------

/**
 * The outer envelope for every frame received from the WebSocket.
 * Inner payload validation is done per-topic via `TOPIC_SCHEMAS`.
 */
export const envelopeSchema = z.object({
  topic: z.string().min(1),
  payload: z.unknown(),
});

export type Envelope = z.infer<typeof envelopeSchema>;

// ---------------------------------------------------------------------------
// Topic registry — maps topic name → payload validator
// ---------------------------------------------------------------------------

/** All topics the frontend currently subscribes to, with their validators. */
export const TOPIC_SCHEMAS: Record<string, z.ZodTypeAny> = {
  oracle_update: oracleUpdateSchema,
};

/** Names of all known topics (derived from TOPIC_SCHEMAS for DRYness). */
export const KNOWN_TOPICS: ReadonlyArray<string> = Object.keys(TOPIC_SCHEMAS);

// ---------------------------------------------------------------------------
// Runtime validation helpers
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  topic: string;
  errors?: z.ZodIssue[];
}

/**
 * Validate a received payload against the registered contract for `topic`.
 *
 * Returns `{ ok: true }` on success.
 * Returns `{ ok: false, errors }` when validation fails — never throws.
 *
 * Unknown topics return `{ ok: true }` (forward-compatibility: the backend
 * may push topics the frontend doesn't know yet; we ignore them rather than
 * treating them as errors).
 */
export function validateFrame(topic: string, payload: unknown): ValidationResult {
  const schema = TOPIC_SCHEMAS[topic];
  if (!schema) return { ok: true, topic }; // unknown topic — ignore gracefully

  const result = schema.safeParse(payload);
  if (result.success) return { ok: true, topic };
  return { ok: false, topic, errors: result.error.issues };
}

/**
 * Like `validateFrame` but throws a `ContractViolationError` on failure.
 * Suitable for strict test assertions.
 */
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

// ---------------------------------------------------------------------------
// OpenAPI → contract alignment helpers (used by contract.test.ts)
// ---------------------------------------------------------------------------

/**
 * Validate a raw YAML-parsed OpenAPI schema object against the expected
 * contract shape. Returns a list of property names that are present in the
 * OpenAPI schema but absent from the Zod schema's `.shape`, or vice-versa.
 *
 * This is a lightweight structural diff — not a full JSON Schema validator —
 * sufficient to catch field additions/removals in the backend contract.
 */
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

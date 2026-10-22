import { z } from "zod";
import type { OracleReading } from "@/lib/api/oracle";
import type { ClaimRecord } from "@/lib/api/claims";

/**
 * The realtime topic/message contract shared with refract-backend.
 *
 * Wire format (server → client):
 *
 *   data frame:     { "topic": string, "v": number, "payload": unknown, "scope"?: Scope }
 *   control frame:  { "type": "subscribed", "topic": string, "v": number }
 *                   { "type": "error", "code": "unsupported_version", "topic": string, "supported"?: number[] }
 *
 * Wire format (client → server):
 *
 *   { "type": "subscribe",   "topic": string, "versions": number[], "scope": Scope }
 *   { "type": "unsubscribe", "topic": string }
 *
 * Every data frame carries an explicit integer version `v`. A frame without
 * `v` is treated as LEGACY_VERSION (1) during the transition period — the
 * shape the backend emitted before versioning existed — rather than as an
 * error. The client advertises the versions it can decode on subscribe; a
 * server that can't serve any of them replies with an `unsupported_version`
 * control frame and the client falls back to REST for that topic.
 *
 * See docs/realtime.md ("Versioning") for the evolution and deprecation policy.
 */

/** Version assumed for frames that omit `v` (pre-versioning servers). */
export const LEGACY_VERSION = 1;

export interface RealtimeScope {
  /** Stellar network id, e.g. "testnet" | "futurenet" | "mainnet". */
  network: string;
  /** Connected wallet address, or null when no wallet is connected. */
  account: string | null;
}

/** "global" topics are the same for everyone on a network; "account" topics are wallet-scoped. */
export type TopicScope = "global" | "account";

type Parser<T> = (payload: unknown) => T;

interface TopicDefinition<T> {
  scope: TopicScope;
  /** Version → parser that normalises that version's payload to the current in-app type. */
  versions: Record<number, Parser<T>>;
}

// ── Payload schemas ───────────────────────────────────────────────────────────

const oracleReadingSchema = z.object({
  coverageType: z.string(),
  type: z.literal("oracle_update"),
  value: z.number(),
  threshold: z.number(),
  severity: z.enum(["low", "medium", "high", "triggered"]),
  message: z.string(),
});

/** v2 nests the reading and adds when the oracle observed it. */
const oracleUpdateV2Schema = z.object({
  reading: oracleReadingSchema.omit({ type: true }),
  observedAt: z.number(),
});

const claimRecordSchema = z.object({
  policyId: z.string(),
  holder: z.string(),
  coverageType: z.number(),
  triggered: z.boolean(),
  payout: z.string(),
  reason: z.string(),
  processedAt: z.number(),
  settlementTxHash: z.string().optional(),
});

// ── Topics ────────────────────────────────────────────────────────────────────

export const TOPICS = {
  /** A new oracle reading for one coverage type. */
  oracle_update: {
    scope: "global",
    versions: {
      1: (p) => oracleReadingSchema.parse(p),
      2: (p) => {
        const { reading } = oracleUpdateV2Schema.parse(p);
        return { ...reading, type: "oracle_update" as const };
      },
    },
  } satisfies TopicDefinition<OracleReading>,

  /** A claim was settled anywhere in the protocol (public "recent payouts"). */
  claim_settled: {
    scope: "global",
    versions: {
      1: (p) => claimRecordSchema.parse(p),
    },
  } satisfies TopicDefinition<ClaimRecord>,

  /** A claim was settled for the connected wallet. */
  holder_claim: {
    scope: "account",
    versions: {
      1: (p) => claimRecordSchema.parse(p),
    },
  } satisfies TopicDefinition<ClaimRecord>,
} as const;

export type TopicName = keyof typeof TOPICS;

/** Decoded payload type for each topic. */
export interface TopicPayloads {
  oracle_update: OracleReading;
  claim_settled: ClaimRecord;
  holder_claim: ClaimRecord;
}

export function isKnownTopic(topic: string): topic is TopicName {
  return Object.prototype.hasOwnProperty.call(TOPICS, topic);
}

/** Versions this bundle can decode for a topic, newest first — what the client advertises on subscribe. */
export function supportedVersions(topic: TopicName): number[] {
  return Object.keys(TOPICS[topic].versions)
    .map(Number)
    .sort((a, b) => b - a);
}

export function topicScope(topic: TopicName): TopicScope {
  return TOPICS[topic].scope;
}

export function parserFor(
  topic: TopicName,
  version: number
): Parser<TopicPayloads[TopicName]> | null {
  const versions = TOPICS[topic].versions as Record<number, Parser<TopicPayloads[TopicName]>>;
  return versions[version] ?? null;
}

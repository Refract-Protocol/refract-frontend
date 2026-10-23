import {
  LEGACY_VERSION,
  isKnownTopic,
  parserFor,
  type RealtimeScope,
  type TopicName,
  type TopicPayloads,
} from "./contract";
import { RealtimeParseError, RealtimeValidationError, UnsupportedVersionError } from "./errors";

/**
 * The parse boundary for realtime frames. Version handling is explicit here:
 * the envelope's `v` picks a parser from the topic's registry in contract.ts,
 * rather than guessing the version from which fields happen to be present.
 */

export interface DataFrame<T extends TopicName = TopicName> {
  kind: "data";
  topic: T;
  version: number;
  payload: TopicPayloads[T];
  /** Scope the server says this frame belongs to, if it included one. */
  scope?: Partial<RealtimeScope>;
}

export type ControlFrame =
  | { kind: "subscribed"; topic: string; version: number }
  | { kind: "unsupported_version"; topic: string; supported: number[] };

export type DecodedFrame = DataFrame | ControlFrame;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readVersion(raw: unknown, topic: string): number {
  if (raw === undefined) return LEGACY_VERSION;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    throw new RealtimeValidationError(`Invalid version field for topic "${topic}"`, { topic });
  }
  return raw;
}

function decodeControl(frame: Record<string, unknown>): ControlFrame {
  const topic = typeof frame.topic === "string" ? frame.topic : "";
  if (frame.type === "subscribed") {
    return { kind: "subscribed", topic, version: readVersion(frame.v, topic) };
  }
  if (frame.type === "error" && frame.code === "unsupported_version") {
    const supported = Array.isArray(frame.supported)
      ? frame.supported.filter((v): v is number => typeof v === "number")
      : [];
    return { kind: "unsupported_version", topic, supported };
  }
  throw new RealtimeParseError(`Unknown control frame "${String(frame.type)}"`, {
    topic: topic || undefined,
  });
}

/**
 * Decodes one raw WebSocket message. Throws a typed RealtimeError on failure:
 * - RealtimeParseError: not JSON, or not an envelope.
 * - RealtimeValidationError: unknown topic, bad version field, or payload fails the schema.
 * - UnsupportedVersionError: a version this bundle has no parser for (non-retryable).
 */
export function decodeFrame(raw: unknown): DecodedFrame {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (cause) {
    throw new RealtimeParseError("Frame is not valid JSON", { cause });
  }
  if (!isRecord(parsed)) throw new RealtimeParseError("Frame is not an object");

  if (typeof parsed.type === "string") return decodeControl(parsed);

  const topic = parsed.topic;
  if (typeof topic !== "string") throw new RealtimeParseError("Frame has no topic");
  if (!("payload" in parsed))
    throw new RealtimeParseError(`Frame for topic "${topic}" has no payload`, { topic });
  if (!isKnownTopic(topic))
    throw new RealtimeValidationError(`Unknown topic "${topic}"`, { topic });

  const version = readVersion(parsed.v, topic);
  const parser = parserFor(topic, version);
  if (!parser) throw new UnsupportedVersionError(topic, version);

  let payload: TopicPayloads[TopicName];
  try {
    payload = parser(parsed.payload);
  } catch (cause) {
    throw new RealtimeValidationError(
      `Payload for topic "${topic}" v${version} failed validation`,
      { topic, cause }
    );
  }

  const scope = isRecord(parsed.scope)
    ? {
        ...(typeof parsed.scope.network === "string" ? { network: parsed.scope.network } : {}),
        ...(typeof parsed.scope.account === "string" || parsed.scope.account === null
          ? { account: parsed.scope.account as string | null }
          : {}),
      }
    : undefined;

  return { kind: "data", topic, version, payload, ...(scope ? { scope } : {}) };
}

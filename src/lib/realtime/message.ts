import {
  INBOUND_TOPIC_SCHEMAS,
  inboundEnvelopeBaseSchema,
  SUPPORTED_PROTOCOL_VERSION,
  type ValidatedTopicName,
  type ValidatedTopicPayloads,
} from "./schemas";

export type ValidationFailureReason =
  | "invalid_json"
  | "invalid_envelope"
  | "version_mismatch"
  | "unknown_topic"
  | "invalid_payload";

export interface ValidatedInboundFrame<
  TTopic extends ValidatedTopicName = ValidatedTopicName,
> {
  v: number;
  id?: string;
  topic: TTopic;
  type?: "snapshot" | "delta" | "event";
  seq?: number;
  ts?: number;
  payload: ValidatedTopicPayloads[TTopic];
}

export type ParseInboundFrameResult =
  | { ok: true; frame: ValidatedInboundFrame }
  | { ok: false; reason: ValidationFailureReason; details: string };

export interface ValidationDiagnosticsSnapshot {
  validCount: number;
  droppedCount: number;
  failureCountsByReason: Record<ValidationFailureReason, number>;
  protocolIncompatible: boolean;
  incompatibleVersionSeen: number | null;
}

export interface InboundMessageValidatorOptions {
  /** Minimum interval (ms) between console.warn logs to prevent console floods (default: 5000). */
  warnIntervalMs?: number;
  /** Custom logger (defaults to console.warn in non-production). */
  warn?: (message: string) => void;
  /** Clock provider for deterministic testing. */
  now?: () => number;
}

/**
 * Stateful boundary validator that parses raw WebSocket/SSE frames against
 * pre-allocated topic schemas, tracks diagnostic counters for observability,
 * marks the transport incompatible on major protocol version mismatches, and
 * rate-limits warning logs.
 */
export class InboundMessageValidator {
  private validCount = 0;
  private droppedCount = 0;
  private readonly failureCounts: Record<ValidationFailureReason, number> = {
    invalid_json: 0,
    invalid_envelope: 0,
    version_mismatch: 0,
    unknown_topic: 0,
    invalid_payload: 0,
  };
  private protocolIncompatible = false;
  private incompatibleVersionSeen: number | null = null;
  private lastWarnAt = -Infinity;
  private suppressedWarnings = 0;
  private readonly warnIntervalMs: number;
  private readonly warnFn: (message: string) => void;
  private readonly now: () => number;

  constructor(options: InboundMessageValidatorOptions = {}) {
    this.warnIntervalMs = options.warnIntervalMs ?? 5_000;
    this.now = options.now ?? (() => Date.now());
    this.warnFn =
      options.warn ??
      ((msg: string) => {
        if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
          console.warn(msg);
        }
      });
  }

  parseRawFrame(raw: string | unknown): ParseInboundFrameResult {
    let decoded: unknown = raw;
    if (typeof raw === "string") {
      try {
        decoded = JSON.parse(raw);
      } catch {
        return this.recordFailure("invalid_json", "Inbound frame is not valid JSON");
      }
    }

    const envelopeParse = inboundEnvelopeBaseSchema.safeParse(decoded);
    if (!envelopeParse.success) {
      return this.recordFailure(
        "invalid_envelope",
        envelopeParse.error.issues[0]?.message ?? "Malformed envelope",
      );
    }

    const envelope = envelopeParse.data;
    const version = envelope.v ?? SUPPORTED_PROTOCOL_VERSION;
    if (version !== SUPPORTED_PROTOCOL_VERSION) {
      this.protocolIncompatible = true;
      this.incompatibleVersionSeen = version;
      return this.recordFailure(
        "version_mismatch",
        `Unsupported protocol version v=${version} (expected v=${SUPPORTED_PROTOCOL_VERSION})`,
      );
    }

    const topic = envelope.topic as ValidatedTopicName;
    const payloadSchema = INBOUND_TOPIC_SCHEMAS[topic];
    if (!payloadSchema) {
      return this.recordFailure("unknown_topic", `Unrecognized realtime topic "${envelope.topic}"`);
    }

    const payloadParse = payloadSchema.safeParse(envelope.payload);
    if (!payloadParse.success) {
      const issue = payloadParse.error.issues[0];
      const fieldPath = issue?.path.join(".") || "payload";
      return this.recordFailure(
        "invalid_payload",
        `Invalid payload for topic "${topic}" at "${fieldPath}": ${issue?.message ?? "schema error"}`,
      );
    }

    this.validCount += 1;
    return {
      ok: true,
      frame: {
        ...envelope,
        v: version,
        topic,
        payload: payloadParse.data as ValidatedTopicPayloads[ValidatedTopicName],
      },
    };
  }

  private recordFailure(
    reason: ValidationFailureReason,
    details: string,
  ): ParseInboundFrameResult {
    this.droppedCount += 1;
    this.failureCounts[reason] += 1;

    const currentTime = this.now();
    if (currentTime - this.lastWarnAt >= this.warnIntervalMs) {
      const suffix =
        this.suppressedWarnings > 0
          ? ` (+${this.suppressedWarnings} suppressed warnings)`
          : "";
      this.warnFn(`[realtime-schema] Dropped frame (${reason}): ${details}${suffix}`);
      this.lastWarnAt = currentTime;
      this.suppressedWarnings = 0;
    } else {
      this.suppressedWarnings += 1;
    }

    return { ok: false, reason, details };
  }

  getDiagnostics(): ValidationDiagnosticsSnapshot {
    return {
      validCount: this.validCount,
      droppedCount: this.droppedCount,
      failureCountsByReason: { ...this.failureCounts },
      protocolIncompatible: this.protocolIncompatible,
      incompatibleVersionSeen: this.incompatibleVersionSeen,
    };
  }

  resetDiagnostics(): void {
    this.validCount = 0;
    this.droppedCount = 0;
    this.failureCounts.invalid_json = 0;
    this.failureCounts.invalid_envelope = 0;
    this.failureCounts.version_mismatch = 0;
    this.failureCounts.unknown_topic = 0;
    this.failureCounts.invalid_payload = 0;
    this.protocolIncompatible = false;
    this.incompatibleVersionSeen = null;
    this.lastWarnAt = -Infinity;
    this.suppressedWarnings = 0;
  }
}

export const inboundMessageValidator = new InboundMessageValidator();

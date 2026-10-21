import type { ClaimRecord, NotificationEvent, OracleReading } from "@/lib/domain/realtime";
import { REALTIME_TOPICS } from "../contract";

export type MappingResult<T> = { ok: true; value: T } | { ok: false; reason: string };
export type RealtimeDomainEvent =
  | { topic: typeof REALTIME_TOPICS.oracle; value: OracleReading }
  | { topic: typeof REALTIME_TOPICS.claim; value: ClaimRecord }
  | {
      topic: typeof REALTIME_TOPICS.notification;
      value: NotificationEvent;
    };

const failed = <T>(reason: string): MappingResult<T> => ({ ok: false, reason });
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function mapOracleUpdate(payload: unknown): MappingResult<OracleReading> {
  if (!record(payload)) return failed("expected an oracle reading object");
  const { coverageType, type, value, threshold, severity, message } = payload;
  if (
    typeof coverageType !== "string" ||
    type !== "oracle_update" ||
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    typeof threshold !== "number" ||
    !Number.isFinite(threshold) ||
    !["low", "medium", "high", "triggered"].includes(String(severity)) ||
    typeof message !== "string"
  )
    return failed("oracle reading does not match the REST domain shape");
  return {
    ok: true,
    value: {
      coverageType,
      type,
      value,
      threshold,
      severity: severity as OracleReading["severity"],
      message,
    },
  };
}

export function mapClaimUpdate(payload: unknown): MappingResult<ClaimRecord> {
  if (!record(payload)) return failed("expected a claim object");
  const {
    policyId,
    holder,
    coverageType,
    triggered,
    payout,
    reason,
    processedAt,
    settlementTxHash,
  } = payload;
  if (
    typeof policyId !== "string" ||
    typeof holder !== "string" ||
    typeof coverageType !== "number" ||
    !Number.isSafeInteger(coverageType) ||
    typeof triggered !== "boolean" ||
    typeof payout !== "string" ||
    !/^\d+$/.test(payout) ||
    typeof reason !== "string" ||
    typeof processedAt !== "number" ||
    !Number.isFinite(processedAt) ||
    (settlementTxHash !== undefined && typeof settlementTxHash !== "string")
  ) {
    return failed("claim does not match the REST domain shape");
  }
  const processedAtMs = Math.round(processedAt * 1000);
  if (!Number.isSafeInteger(processedAtMs)) {
    return failed("claim timestamp is outside the supported range");
  }
  return {
    ok: true,
    value: {
      policyId,
      holder,
      coverageType,
      triggered,
      payout,
      reason,
      processedAt: processedAtMs,
      ...(settlementTxHash === undefined ? {} : { settlementTxHash }),
    },
  };
}

export function mapNotificationUpdate(payload: unknown): MappingResult<NotificationEvent> {
  if (
    !record(payload) ||
    typeof payload.id !== "string" ||
    typeof payload.message !== "string" ||
    typeof payload.timestamp !== "number" ||
    !Number.isFinite(payload.timestamp)
  ) {
    return failed("notification does not match the domain shape");
  }
  return {
    ok: true,
    value: { id: payload.id, message: payload.message, timestamp: payload.timestamp },
  };
}

export function mapRealtimeEvent(
  topic: string,
  payload: unknown
): MappingResult<RealtimeDomainEvent> {
  if (topic === REALTIME_TOPICS.oracle) {
    const result = mapOracleUpdate(payload);
    return result.ok ? { ok: true, value: { topic, value: result.value } } : result;
  }
  if (topic === REALTIME_TOPICS.claim) {
    const result = mapClaimUpdate(payload);
    return result.ok ? { ok: true, value: { topic, value: result.value } } : result;
  }
  if (topic === REALTIME_TOPICS.notification) {
    const result = mapNotificationUpdate(payload);
    return result.ok ? { ok: true, value: { topic, value: result.value } } : result;
  }
  return failed(`unsupported realtime topic: ${topic}`);
}

export type RealtimeErrorKind =
  | "transport"
  | "auth"
  | "contract_mismatch"
  | "rate_limit"
  | "server_error"
  | "timeout";

export type RealtimeErrorSeverity = "info" | "warning" | "critical";

export type RealtimeRecoveryAction =
  | "silent_retry"
  | "inline_banner"
  | "fallback_to_rest"
  | "manual_retry";

export interface RealtimeFailurePresentation {
  kind: RealtimeErrorKind;
  severity: RealtimeErrorSeverity;
  retryable: boolean;
  shouldAutoReconnect: boolean;
  recoveryAction: RealtimeRecoveryAction;
  userTitle: string;
  userMessage: string;
  recoveryHint: string;
}

export interface RealtimeClassifiedError extends RealtimeFailurePresentation {
  code?: string | number;
  topic?: string;
  retryAfterMs?: number;
  occurredAt: number;
}

/**
 * Authoritative mapping table from `RealtimeErrorKind` to user-facing copy,
 * severity, retryability, and recovery behavior. Never exposes raw stack traces
 * or low-level socket strings to the UI.
 */
export const REALTIME_ERROR_TAXONOMY: Readonly<
  Record<RealtimeErrorKind, RealtimeFailurePresentation>
> = {
  transport: {
    kind: "transport",
    severity: "info",
    retryable: true,
    shouldAutoReconnect: true,
    recoveryAction: "silent_retry",
    userTitle: "Reconnecting to live stream",
    userMessage: "Live updates were interrupted. Continuing with automatic background refreshes.",
    recoveryHint: "Reconnecting automatically in the background.",
  },
  timeout: {
    kind: "timeout",
    severity: "info",
    retryable: true,
    shouldAutoReconnect: true,
    recoveryAction: "silent_retry",
    userTitle: "Live stream response delayed",
    userMessage: "The live feed did not respond in time. Falling back to periodic snapshots while reconnecting.",
    recoveryHint: "Your data stays up to date via periodic snapshots.",
  },
  rate_limit: {
    kind: "rate_limit",
    severity: "warning",
    retryable: true,
    shouldAutoReconnect: true,
    recoveryAction: "inline_banner",
    userTitle: "Live updates throttled",
    userMessage: "Update frequency has been temporarily reduced due to high traffic.",
    recoveryHint: "Full-speed streaming will resume automatically after cooldown.",
  },
  server_error: {
    kind: "server_error",
    severity: "warning",
    retryable: true,
    shouldAutoReconnect: true,
    recoveryAction: "fallback_to_rest",
    userTitle: "Live stream temporarily unavailable",
    userMessage: "The realtime service encountered an upstream issue. Displaying verified snapshot data instead.",
    recoveryHint: "Retry will occur automatically once the service recovers.",
  },
  auth: {
    kind: "auth",
    severity: "warning",
    retryable: false,
    shouldAutoReconnect: false,
    recoveryAction: "manual_retry",
    userTitle: "Wallet session expired",
    userMessage: "Wallet-scoped notifications require an active session.",
    recoveryHint: "Reconnect your wallet to resume private account alerts.",
  },
  contract_mismatch: {
    kind: "contract_mismatch",
    severity: "critical",
    retryable: false,
    shouldAutoReconnect: false,
    recoveryAction: "fallback_to_rest",
    userTitle: "App update required for live stream",
    userMessage: "This version of the app uses an older live-stream format. Data is being refreshed via standard requests.",
    recoveryHint: "Reload the page to load the latest application version.",
  },
};

export interface ClassifyRealtimeFailureInput {
  kind?: RealtimeErrorKind;
  code?: string | number;
  reason?: string;
  topic?: string;
  retryAfterMs?: number;
  now?: number;
}

/**
 * Normalizes transport close codes, protocol error frames, schema mismatches,
 * or heartbeat timeouts into a structured `RealtimeClassifiedError` safe for
 * UI consumption and health telemetry.
 */
export function classifyRealtimeFailure(
  input: ClassifyRealtimeFailureInput,
): RealtimeClassifiedError {
  const occurredAt = input.now ?? Date.now();
  const kind = input.kind ?? inferErrorKind(input.code, input.reason);
  const template = REALTIME_ERROR_TAXONOMY[kind];

  return {
    ...template,
    code: input.code,
    topic: input.topic,
    retryAfterMs: input.retryAfterMs,
    occurredAt,
  };
}

function inferErrorKind(
  code?: string | number,
  reason?: string,
): RealtimeErrorKind {
  const normalizedCode = typeof code === "string" ? code.toUpperCase() : code;
  const normalizedReason = (reason ?? "").toLowerCase();

  if (
    normalizedCode === "UNAUTHORIZED" ||
    normalizedCode === "TOKEN_EXPIRED" ||
    normalizedCode === 401 ||
    normalizedCode === 403 ||
    normalizedCode === 4401 ||
    normalizedCode === 4403 ||
    normalizedReason.includes("unauthorized") ||
    normalizedReason.includes("token_expired") ||
    normalizedReason.includes("auth")
  ) {
    return "auth";
  }

  if (
    normalizedCode === "VERSION_MISMATCH" ||
    normalizedCode === "UNKNOWN_TOPIC" ||
    normalizedCode === "PAYLOAD_TOO_LARGE" ||
    normalizedCode === 1002 ||
    normalizedCode === 1003 ||
    normalizedCode === 1007 ||
    normalizedCode === 4400 ||
    normalizedReason.includes("version_mismatch") ||
    normalizedReason.includes("invalid_payload") ||
    normalizedReason.includes("schema")
  ) {
    return "contract_mismatch";
  }

  if (
    normalizedCode === "RATE_LIMITED" ||
    normalizedCode === "BACKPRESSURE_DROP" ||
    normalizedCode === 429 ||
    normalizedCode === 1008 ||
    normalizedCode === 4429 ||
    normalizedReason.includes("rate_limit") ||
    normalizedReason.includes("throttl")
  ) {
    return "rate_limit";
  }

  if (
    normalizedCode === "INTERNAL_ERROR" ||
    normalizedCode === 1011 ||
    normalizedCode === 1012 ||
    normalizedCode === 1013 ||
    (typeof normalizedCode === "number" && normalizedCode >= 500 && normalizedCode < 600) ||
    normalizedReason.includes("internal_error") ||
    normalizedReason.includes("server_error")
  ) {
    return "server_error";
  }

  if (
    normalizedCode === "TIMEOUT" ||
    normalizedCode === "HEARTBEAT_TIMEOUT" ||
    normalizedReason.includes("timeout") ||
    normalizedReason.includes("missed pong") ||
    normalizedReason.includes("stale")
  ) {
    return "timeout";
  }

  return "transport";
}

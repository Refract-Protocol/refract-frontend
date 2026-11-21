/**
 * Realtime error taxonomy.
 *
 * A single shared vocabulary for realtime failures so hooks, the transport
 * boundary, and UI surfaces (e.g. the Navbar status indicator) all agree on
 * what went wrong, how severe it is, whether it is retryable, and what the
 * user should see. Keep all copy/behavior mapping in `REALTIME_ERROR_MAP` so
 * it stays testable in one place.
 */

export type RealtimeErrorKind =
  | "transport"
  | "auth"
  | "contract"
  | "rate_limit"
  | "server"
  | "timeout";

export type RealtimeErrorSeverity = "info" | "warning" | "error";

/**
 * How the client should react to a failure:
 * - `silent-retry`: transient blip, retry quietly without alarming the user.
 * - `inline-banner`: surface a non-blocking banner while retrying.
 * - `fallback-rest`: realtime is unusable; fall back to REST polling.
 * - `manual-retry`: stop auto-reconnect; require an explicit user action.
 */
export type RealtimeErrorBehavior =
  | "silent-retry"
  | "inline-banner"
  | "fallback-rest"
  | "manual-retry";

export interface RealtimeError {
  kind: RealtimeErrorKind;
  severity: RealtimeErrorSeverity;
  retryable: boolean;
  behavior: RealtimeErrorBehavior;
  /** Short, user-facing message. Never contains raw socket/stack strings. */
  message: string;
  /** Optional recovery hint shown alongside the message. */
  hint?: string;
  /** Original error for logging/debugging only; never rendered to users. */
  cause?: unknown;
}

export interface RealtimeErrorCopy {
  severity: RealtimeErrorSeverity;
  retryable: boolean;
  behavior: RealtimeErrorBehavior;
  message: string;
  hint?: string;
}

/** Single source of truth mapping each kind to copy and behavior. */
export const REALTIME_ERROR_MAP: Record<RealtimeErrorKind, RealtimeErrorCopy> = {
  transport: {
    severity: "warning",
    retryable: true,
    behavior: "silent-retry",
    message: "Live updates are reconnecting.",
    hint: "Data may be briefly out of date.",
  },
  auth: {
    severity: "error",
    retryable: false,
    behavior: "manual-retry",
    message: "Your session has expired.",
    hint: "Reconnect your wallet to resume live updates.",
  },
  contract: {
    severity: "error",
    retryable: false,
    behavior: "fallback-rest",
    message: "Live updates are unavailable in this version.",
    hint: "Showing the latest data instead.",
  },
  rate_limit: {
    severity: "warning",
    retryable: true,
    behavior: "inline-banner",
    message: "Too many live updates right now.",
    hint: "We'll slow down and retry automatically.",
  },
  server: {
    severity: "error",
    retryable: true,
    behavior: "inline-banner",
    message: "The live update service is having trouble.",
    hint: "Retrying automatically.",
  },
  timeout: {
    severity: "warning",
    retryable: true,
    behavior: "silent-retry",
    message: "Live updates are taking longer than usual.",
    hint: "Reconnecting shortly.",
  },
};

/** Build a normalized error object from a kind, attaching the raw cause. */
export function createRealtimeError(
  kind: RealtimeErrorKind,
  cause?: unknown
): RealtimeError {
  const copy = REALTIME_ERROR_MAP[kind];
  return {
    kind,
    severity: copy.severity,
    retryable: copy.retryable,
    behavior: copy.behavior,
    message: copy.message,
    hint: copy.hint,
    cause,
  };
}

/**
 * Classify an arbitrary thrown/emitted error into a normalized realtime error.
 * Only inspects documented signals (HTTP status, close codes, message text);
 * never surfaces raw strings to users.
 */
export function classifyRealtimeError(error: unknown): RealtimeError {
  const status = extractStatus(error);
  if (status === 401 || status === 403) return createRealtimeError("auth", error);
  if (status === 429) return createRealtimeError("rate_limit", error);
  if (status !== undefined && status >= 500) return createRealtimeError("server", error);
  if (status !== undefined && status >= 400) return createRealtimeError("contract", error);

  const text = extractText(error).toLowerCase();
  if (text.includes("timeout") || text.includes("timed out")) {
    return createRealtimeError("timeout", error);
  }
  if (text.includes("schema") || text.includes("contract") || text.includes("parse")) {
    return createRealtimeError("contract", error);
  }
  if (text.includes("unauthorized") || text.includes("forbidden") || text.includes("auth")) {
    return createRealtimeError("auth", error);
  }
  return createRealtimeError("transport", error);
}

function extractStatus(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const candidate = error as { status?: unknown; code?: unknown };
    if (typeof candidate.status === "number") return candidate.status;
    if (typeof candidate.code === "number") return candidate.code;
  }
  return undefined;
}

function extractText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown };
    if (typeof candidate.message === "string") return candidate.message;
  }
  return "";
}

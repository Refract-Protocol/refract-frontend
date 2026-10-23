import type { RealtimeError } from "./errors";

/**
 * Error/breadcrumb reporting for the realtime layer.
 *
 * The client only talks to the small `RealtimeReporter` interface, so tests
 * can pass a stub and swapping Sentry for another provider only touches the
 * sink. The default reporter wraps a Sentry sink with:
 * - scrubbing of auth tokens and wallet-scoped identifiers,
 * - breadcrumb rate limiting (a reconnect storm can't flood the event),
 * - error deduplication keyed on topic + failure class.
 *
 * The Sentry SDK itself is not bundled here (see #145); the sink reports to
 * `globalThis.Sentry` when the SDK is loaded and is a no-op otherwise.
 */

export type RealtimeFallbackState = "none" | "topic" | "all";

export interface RealtimeErrorContext {
  topic?: string;
  transport: "websocket";
  /** Reconnect attempt number at the time of the error (0 when connected). */
  attempt: number;
  fallback: RealtimeFallbackState;
}

export type RealtimeLifecycleEvent =
  "connecting" | "open" | "reconnect_scheduled" | "fallback_engaged" | "closed" | "scope_changed";

export interface RealtimeBreadcrumb {
  event: RealtimeLifecycleEvent;
  level: "info" | "warning";
  data?: Record<string, unknown>;
}

export interface RealtimeReporter {
  captureError(error: RealtimeError, context: RealtimeErrorContext): void;
  addBreadcrumb(crumb: RealtimeBreadcrumb): void;
}

export const noopReporter: RealtimeReporter = {
  captureError: () => {},
  addBreadcrumb: () => {},
};

// ── Scrubbing ────────────────────────────────────────────────────────────────

const REDACTED = "[redacted]";
const SENSITIVE_KEY =
  /token|auth|secret|password|passphrase|signature|jwt|cookie|session|xdr|api[-_]?key/i;
/** Wallet-scoped identifiers: Stellar G… accounts and M… muxed accounts. */
const ACCOUNT_RE = /\b(?:G[A-Z2-7]{55}|M[A-Z2-7]{68})\b/g;
const BEARER_RE = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_VALUE_SECRET_RE =
  /(\b(?:token|auth|access_token|refresh_token|api_key|apikey|key|signature|secret|password)=)[^&#\s]+/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
const ACCOUNT_KEY = /^(account|address|holder|wallet|provider)$/i;

export function scrubString(value: string): string {
  return value
    .replace(BEARER_RE, `$1 ${REDACTED}`)
    .replace(KEY_VALUE_SECRET_RE, `$1${REDACTED}`)
    .replace(JWT_RE, REDACTED)
    .replace(ACCOUNT_RE, "[account]");
}

/** Deep-copies `value` with secrets and wallet identifiers removed. */
export function scrub<T>(value: T, depth = 0): T {
  if (depth > 6) return REDACTED as unknown as T;
  if (typeof value === "string") return scrubString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) out[key] = REDACTED;
      else if (ACCOUNT_KEY.test(key) && inner != null) out[key] = "[account]";
      else out[key] = scrub(inner, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Copy of a RealtimeError with a scrubbed message (the original is left untouched). */
function scrubError(error: RealtimeError): RealtimeError {
  const copy = Object.create(Object.getPrototypeOf(error)) as RealtimeError;
  Object.assign(copy, error);
  Object.defineProperty(copy, "message", { value: scrubString(error.message), enumerable: false });
  Object.defineProperty(copy, "stack", {
    value: error.stack ? scrubString(error.stack) : undefined,
    enumerable: false,
  });
  // `cause` may hold the raw frame; never forward it.
  Object.defineProperty(copy, "cause", { value: undefined, enumerable: false });
  return copy;
}

// ── Rate limiting / dedup ────────────────────────────────────────────────────

export interface RateLimitOptions {
  /** Max breadcrumbs forwarded per window. */
  breadcrumbLimit?: number;
  breadcrumbWindowMs?: number;
  /** Min time between two forwarded errors with the same topic + kind. */
  errorDedupWindowMs?: number;
  now?: () => number;
}

/**
 * Wraps a sink with scrubbing, breadcrumb rate limiting and error dedup.
 * Suppressed counts are attached to the next forwarded item so the volume
 * is still visible in the report.
 */
export function createReporter(
  sink: RealtimeReporter,
  opts: RateLimitOptions = {}
): RealtimeReporter {
  const {
    breadcrumbLimit = 20,
    breadcrumbWindowMs = 60_000,
    errorDedupWindowMs = 5 * 60_000,
    now = () => Date.now(),
  } = opts;

  let windowStart = now();
  let crumbsInWindow = 0;
  let droppedCrumbs = 0;
  let lastCrumbKey: string | null = null;
  let repeats = 0;
  const lastErrorAt = new Map<string, number>();
  const suppressedErrors = new Map<string, number>();

  return {
    addBreadcrumb(crumb) {
      const t = now();
      if (t - windowStart >= breadcrumbWindowMs) {
        windowStart = t;
        crumbsInWindow = 0;
      }
      // Collapse identical consecutive crumbs (e.g. repeated reconnect_scheduled).
      const key = `${crumb.event}:${JSON.stringify(crumb.data ?? {})}`;
      if (key === lastCrumbKey) {
        repeats += 1;
        return;
      }
      if (crumbsInWindow >= breadcrumbLimit) {
        droppedCrumbs += 1;
        return;
      }
      const extra: Record<string, unknown> = {};
      if (repeats > 0) extra.previousRepeats = repeats;
      if (droppedCrumbs > 0) extra.droppedBefore = droppedCrumbs;
      lastCrumbKey = key;
      repeats = 0;
      droppedCrumbs = 0;
      crumbsInWindow += 1;
      sink.addBreadcrumb({ ...crumb, data: scrub({ ...crumb.data, ...extra }) });
    },

    captureError(error, context) {
      const key = `${context.topic ?? "*"}:${error.kind}`;
      const t = now();
      const last = lastErrorAt.get(key);
      if (last !== undefined && t - last < errorDedupWindowMs) {
        suppressedErrors.set(key, (suppressedErrors.get(key) ?? 0) + 1);
        return;
      }
      lastErrorAt.set(key, t);
      const suppressed = suppressedErrors.get(key) ?? 0;
      suppressedErrors.delete(key);
      sink.captureError(
        scrubError(error),
        scrub({ ...context, ...(suppressed ? { suppressed } : {}) })
      );
    },
  };
}

// ── Sentry sink ──────────────────────────────────────────────────────────────

/** The slice of the Sentry browser SDK this sink uses. */
export interface SentryLike {
  captureException(
    error: unknown,
    hint?: {
      tags?: Record<string, string>;
      fingerprint?: string[];
      extra?: Record<string, unknown>;
    }
  ): unknown;
  addBreadcrumb(crumb: {
    category: string;
    message: string;
    level: string;
    data?: Record<string, unknown>;
  }): void;
}

function globalSentry(): SentryLike | undefined {
  const candidate = (globalThis as { Sentry?: SentryLike }).Sentry;
  return candidate && typeof candidate.captureException === "function" ? candidate : undefined;
}

/** Forwards to Sentry with structured tags; does nothing when the SDK isn't loaded. */
export function createSentrySink(
  getSentry: () => SentryLike | undefined = globalSentry
): RealtimeReporter {
  return {
    captureError(error, context) {
      const sentry = getSentry();
      if (!sentry) return;
      const { topic, transport, attempt, fallback, ...extra } = context as RealtimeErrorContext &
        Record<string, unknown>;
      sentry.captureException(error, {
        tags: {
          "realtime.kind": error.kind,
          "realtime.topic": topic ?? "none",
          "realtime.transport": transport,
          "realtime.attempt": String(attempt),
          "realtime.fallback": fallback,
          "realtime.retryable": String(error.retryable),
        },
        fingerprint: ["realtime", error.kind, topic ?? "none"],
        extra,
      });
    },
    addBreadcrumb(crumb) {
      getSentry()?.addBreadcrumb({
        category: "realtime",
        message: crumb.event,
        level: crumb.level,
        data: crumb.data,
      });
    },
  };
}

/** The reporter the app uses by default: Sentry behind scrubbing + rate limits. */
export function createDefaultReporter(): RealtimeReporter {
  return createReporter(createSentrySink());
}

import type { ErrorEvent } from "@sentry/nextjs";

const REDACTED = "[Filtered]";

// Stellar secret seeds: "S" + 55 base32 characters. Public keys ("G" + 55) are
// public on-chain data and are intentionally kept.
const SECRET_SEED = /\bS[A-Z2-7]{55}\b/g;
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "set-cookie"]);

function stripQuery(url: string): string {
  const i = url.search(/[?#]/);
  return i === -1 ? url : url.slice(0, i);
}

function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.replace(SECRET_SEED, REDACTED);
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = scrubDeep(v, depth + 1);
  return out;
}

/**
 * Report a malformed event without dropping it. In dev we surface the problem
 * on the console; in prod we attach a breadcrumb so it reaches Sentry.
 */
function warnMalformed(event: ErrorEvent, reason: string): void {
  const message = `[monitoring] scrubber received malformed event (${reason}); passing through unscrubbed`;
  if (process.env.NODE_ENV !== "production") {
    console.warn(message, event);
    return;
  }
  try {
    const breadcrumbs = (event.breadcrumbs ??= []);
    breadcrumbs.push({
      category: "monitoring.scrub",
      level: "warning",
      message,
      timestamp: Date.now() / 1000,
    });
  } catch {
    // Never let diagnostics break event delivery.
  }
}

/** Shared `beforeSend` for the client, server and edge Sentry configs. */
export function beforeSend(event: ErrorEvent): ErrorEvent {
  if (event === null || typeof event !== "object") {
    warnMalformed(event, "event is not an object");
    return event;
  }

  let scrubbed: ErrorEvent;
  try {
    scrubbed = scrubDeep(event) as ErrorEvent;
  } catch (err) {
    warnMalformed(event, `scrub failed: ${(err as Error)?.message ?? "unknown"}`);
    return event;
  }

  if (scrubbed.request) {
    const req = scrubbed.request;
    if (req.headers) {
      for (const name of Object.keys(req.headers)) {
        if (SENSITIVE_HEADERS.has(name.toLowerCase())) req.headers[name] = REDACTED;
      }
    }
    delete req.cookies;
    delete req.data;
    delete req.query_string;
    if (req.url) req.url = stripQuery(req.url);
  }

  if (scrubbed.user) {
    delete scrubbed.user.email;
    delete scrubbed.user.ip_address;
  }

  for (const crumb of scrubbed.breadcrumbs ?? []) {
    const data = crumb.data;
    if (!data) continue;
    for (const key of ["url", "from", "to"]) {
      if (typeof data[key] === "string") data[key] = stripQuery(data[key]);
    }
  }

  return scrubbed;
}

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

function scrubEvent(event: ErrorEvent): ErrorEvent {
  const scrubbed = scrubDeep(event) as ErrorEvent;

  const req = scrubbed.request;
  if (req && typeof req === "object") {
    if (req.headers && typeof req.headers === "object") {
      for (const name of Object.keys(req.headers)) {
        if (SENSITIVE_HEADERS.has(name.toLowerCase())) req.headers[name] = REDACTED;
      }
    }
    delete req.cookies;
    delete req.data;
    delete req.query_string;
    if (typeof req.url === "string") req.url = stripQuery(req.url);
  }

  const user = scrubbed.user;
  if (user && typeof user === "object") {
    delete user.email;
    delete user.ip_address;
  }

  for (const crumb of scrubbed.breadcrumbs ?? []) {
    const data = crumb?.data;
    if (!data || typeof data !== "object") continue;
    for (const key of ["url", "from", "to"]) {
      if (typeof data[key] === "string") data[key] = stripQuery(data[key]);
    }
  }

  return scrubbed;
}

/**
 * Shared `beforeSend` for the client, server and edge Sentry configs.
 *
 * This hook must never throw: an exception in `beforeSend` causes Sentry to
 * silently drop the whole event. Missing or malformed fields are skipped
 * rather than treated as fatal, and any unexpected failure falls back to the
 * original event.
 */
export function beforeSend(event: ErrorEvent): ErrorEvent {
  try {
    return scrubEvent(event);
  } catch {
    return event;
  }
}

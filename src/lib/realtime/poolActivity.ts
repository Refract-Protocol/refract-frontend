import type { PoolActivityEvent } from "./topics";

export const MAX_FEED_LENGTH = 20;
/** Presence is ephemeral: with no update inside this window the indicator reverts to "no data". */
export const PRESENCE_TTL_MS = 60_000;

const KINDS = new Set<PoolActivityEvent["kind"]>(["deposit", "withdraw", "coverage_written"]);

/**
 * Payload allowlist: copies only the known pool-level fields, so a backend
 * that adds wallet addresses or exact position sizes can never leak them
 * into the UI through this topic.
 */
export function sanitizeActivity(raw: unknown): PoolActivityEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    typeof r.at !== "number" ||
    !KINDS.has(r.kind as PoolActivityEvent["kind"])
  )
    return null;
  return {
    id: r.id,
    kind: r.kind as PoolActivityEvent["kind"],
    at: r.at,
    ...(typeof r.sizeBucket === "string" ? { sizeBucket: r.sizeBucket } : {}),
  };
}

/** Newest-first, de-duplicated, capped ring buffer. */
export function pushActivity(
  feed: PoolActivityEvent[],
  event: PoolActivityEvent,
  max = MAX_FEED_LENGTH
): PoolActivityEvent[] {
  if (feed.some((e) => e.id === event.id)) return feed;
  return [event, ...feed].slice(0, max);
}

export function sanitizePresence(raw: unknown): number | null {
  const n = (raw as { active?: unknown } | null)?.active;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

export function isPresenceFresh(
  receivedAt: number | null,
  now: number,
  ttl = PRESENCE_TTL_MS
): boolean {
  return receivedAt !== null && now - receivedAt < ttl;
}

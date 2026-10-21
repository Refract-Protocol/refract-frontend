export type DataSource = "realtime" | "api" | "chain" | "fixture";
export type Freshness = "fresh" | "aging" | "stale" | "unknown";

export function getFreshness(
  timestamp: number | null,
  now: number,
  windowMs = 30_000,
  reconnectStartedAt: number | null = null
): Freshness {
  if (timestamp === null || !Number.isFinite(timestamp)) return "unknown";
  const age = Math.max(0, now - timestamp);
  if (age <= windowMs) return "fresh";
  if (age <= windowMs * 2 || (reconnectStartedAt !== null && now - reconnectStartedAt < 5_000))
    return "aging";
  return "stale";
}

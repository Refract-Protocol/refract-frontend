import type { RealtimeTopic } from "./protocol";

/** Global kill switch; dominates every per-topic flag. */
export const REALTIME_GLOBAL_FLAG = "realtime-enabled";

export const REALTIME_TOPIC_FLAGS: Record<RealtimeTopic, string> = {
  oracle: "realtime-oracle",
  claims: "realtime-claims",
  pool: "realtime-pool",
  notifications: "realtime-notifications",
};

/** Keeps only boolean entries; a missing or malformed document yields no flags (everything off). */
export function sanitizeFlags(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

/** The single gating helper every realtime consumer must use. A topic is on only if the kill switch AND its own flag are true. */
export function isRealtimeTopicEnabled(
  flags: Record<string, boolean> | null | undefined,
  topic: RealtimeTopic
): boolean {
  return flags?.[REALTIME_GLOBAL_FLAG] === true && flags[REALTIME_TOPIC_FLAGS[topic]] === true;
}

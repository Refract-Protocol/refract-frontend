export type RealtimeAnalyticsEventName =
  | "connected"
  | "fallback_activated"
  | "fallback_deactivated"
  | "topic_subscribed"
  | "topic_unsubscribed"
  | "subscription_failure"
  | "unavailable";
export interface RealtimeAnalyticsEvent {
  type: "realtime";
  name: RealtimeAnalyticsEventName;
  transport?: "ws" | "sse" | "rest";
  topic?: string;
  network?: string;
  flagBucket: "enabled" | "disabled" | "unknown";
  reason?: string;
  timestamp: number;
}
export type RealtimeAnalyticsSink = (event: RealtimeAnalyticsEvent) => void;
let sink: RealtimeAnalyticsSink = () => undefined;
const seen = new Map<string, number>();
const queue: RealtimeAnalyticsEvent[] = [];
let flushScheduled = false;
const WINDOW_MS = 60_000;
const MAX_QUEUE = 64;
const KNOWN_TOPICS = new Set(["oracle_update", "recent_claims", "claims", "notifications"]);

export function setRealtimeAnalyticsSink(next: RealtimeAnalyticsSink): void {
  sink = next;
}
export function emitRealtimeEvent(
  name: RealtimeAnalyticsEventName,
  dimensions: Pick<RealtimeAnalyticsEvent, "transport" | "topic" | "reason"> & {
    flagBucket?: RealtimeAnalyticsEvent["flagBucket"];
  } = {}
): void {
  if (
    typeof window === "undefined" ||
    navigator.doNotTrack === "1" ||
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
  )
    return;
  const now = Date.now();
  const key = `${name}:${dimensions.transport ?? ""}:${dimensions.topic ?? ""}:${dimensions.reason ?? ""}`;
  if (now - (seen.get(key) ?? 0) < WINDOW_MS) return;
  seen.set(key, now);
  if (seen.size > 128)
    for (const [seenKey, timestamp] of seen) if (now - timestamp >= WINDOW_MS) seen.delete(seenKey);
  const event: RealtimeAnalyticsEvent = {
    type: "realtime",
    name,
    transport: dimensions.transport,
    topic: dimensions.topic
      ? KNOWN_TOPICS.has(dimensions.topic)
        ? dimensions.topic
        : "other"
      : undefined,
    reason: dimensions.reason,
    network: process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "unknown",
    flagBucket: dimensions.flagBucket ?? (name === "unavailable" ? "disabled" : "enabled"),
    timestamp: now,
  };
  if (queue.length >= MAX_QUEUE) return;
  queue.push(event);
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    const batch = queue.splice(0, queue.length);
    for (const item of batch)
      try {
        sink(item);
      } catch {
        /* Analytics cannot affect realtime. */
      }
  });
}

import type { RefractNotification } from "@/lib/notifications";

const notificationTypes = new Set<RefractNotification["type"]>([
  "policy_expiring",
  "claim_payout",
  "lockup_expired",
  "lockup_soon",
  "oracle_trigger",
]);

export function normalizeNotification(value: unknown): RefractNotification | null {
  const outer = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const item =
    outer?.notification && typeof outer.notification === "object"
      ? (outer.notification as Record<string, unknown>)
      : outer;
  if (
    !item ||
    typeof item.id !== "string" ||
    typeof item.type !== "string" ||
    !notificationTypes.has(item.type as RefractNotification["type"])
  )
    return null;
  const timestamp = Number(item.timestamp ?? item.createdAt ?? Date.now());
  const severity = ["info", "warning", "success", "critical"].includes(String(item.severity))
    ? (item.severity as RefractNotification["severity"])
    : "info";
  return {
    id: item.id,
    type: item.type as RefractNotification["type"],
    title: String(item.title ?? "Refract update"),
    message: String(item.message ?? "There is a new update on your account."),
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    read: item.read === true,
    href: typeof item.href === "string" ? item.href : undefined,
    severity,
  };
}

export function mergeNotifications(
  current: RefractNotification[],
  incoming: RefractNotification,
  limit = 100
): RefractNotification[] {
  const previous = current.find((item) => item.id === incoming.id);
  const item =
    previous && previous.timestamp > incoming.timestamp
      ? previous
      : { ...previous, ...incoming, read: Boolean(previous?.read || incoming.read) };
  return [item, ...current.filter((candidate) => candidate.id !== item.id)]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

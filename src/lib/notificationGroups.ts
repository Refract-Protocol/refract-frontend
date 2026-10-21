import type { RefractNotification } from "./notifications";

export interface NotificationGroup {
  key: string;
  items: RefractNotification[];
  unread: number;
  latest: number;
}

/** Merges two copies of the notification lists, deduplicating by id (first wins). */
export function mergeNotifications(...lists: RefractNotification[][]): RefractNotification[] {
  const byId = new Map<string, RefractNotification>();
  for (const list of lists) for (const n of list) if (!byId.has(n.id)) byId.set(n.id, n);
  return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
}

/** Groups by `groupKey` (falling back to type); groups ordered by latest item, items by timestamp desc. */
export function groupNotifications(items: RefractNotification[]): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();
  for (const n of items) {
    const key = n.groupKey ?? n.type;
    const g = groups.get(key) ?? { key, items: [], unread: 0, latest: 0 };
    g.items.push(n);
    if (!n.read) g.unread += 1;
    g.latest = Math.max(g.latest, n.timestamp);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.items.sort((a, b) => b.timestamp - a.timestamp);
  return [...groups.values()].sort((a, b) => b.latest - a.latest);
}

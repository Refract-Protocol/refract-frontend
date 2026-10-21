import { describe, it, expect } from "vitest";
import { groupNotifications, mergeNotifications } from "./notificationGroups";
import type { RefractNotification } from "./notifications";

const n = (
  id: string,
  timestamp: number,
  extra: Partial<RefractNotification> = {}
): RefractNotification => ({
  id,
  type: "claim_payout",
  title: id,
  message: "",
  timestamp,
  read: false,
  severity: "info",
  ...extra,
});

describe("notification groups", () => {
  it("dedupes by id and orders by timestamp", () => {
    const merged = mergeNotifications([n("a", 1), n("b", 3)], [n("a", 1), n("c", 2)]);
    expect(merged.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("groups by key with unread counts, newest group first", () => {
    const groups = groupNotifications([
      n("1", 1, { groupKey: "claim:x" }),
      n("2", 5, { groupKey: "claim:x", read: true }),
      n("3", 9, { groupKey: "policy:y" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["policy:y", "claim:x"]);
    expect(groups[1]).toMatchObject({ unread: 1, latest: 5 });
    expect(groups[1].items.map((x) => x.id)).toEqual(["2", "1"]);
  });
});

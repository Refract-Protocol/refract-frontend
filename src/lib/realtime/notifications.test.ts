import { describe, expect, it } from "vitest";
import { mergeNotifications, normalizeNotification } from "./notifications";

const item = (id: string, timestamp: number, title = id) => ({
  id,
  type: "claim_payout" as const,
  title,
  message: "Claim settled",
  timestamp,
  read: false,
  severity: "success" as const,
});

describe("notification stream merge", () => {
  it("normalizes notification envelopes", () => {
    expect(normalizeNotification({ notification: item("n1", 5) })).toMatchObject({
      id: "n1",
      timestamp: 5,
    });
  });

  it("orders inserts, deduplicates replay, and keeps newer values on old replay", () => {
    let rows = mergeNotifications([], item("new", 10));
    rows = mergeNotifications(rows, item("old", 5));
    rows = mergeNotifications(rows, item("new", 10, "updated"));
    rows = mergeNotifications(rows, item("new", 2, "replay"));
    expect(rows.map((entry) => entry.id)).toEqual(["new", "old"]);
    expect(rows[0]?.title).toBe("updated");
  });

  it("preserves an item's read state when a later event amends it", () => {
    const read = { ...item("n1", 5), read: true };
    expect(mergeNotifications([read], item("n1", 6, "Amended"))[0]?.read).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  isPresenceFresh,
  MAX_FEED_LENGTH,
  PRESENCE_TTL_MS,
  pushActivity,
  sanitizeActivity,
  sanitizePresence,
} from "./poolActivity";
import type { PoolActivityEvent } from "./topics";

const ev = (n: number): PoolActivityEvent => ({ id: `e${n}`, kind: "deposit", at: n });

describe("pool activity", () => {
  it("caps the feed, newest first, and dedupes ids", () => {
    let feed: PoolActivityEvent[] = [];
    for (let i = 0; i < MAX_FEED_LENGTH + 5; i++) feed = pushActivity(feed, ev(i));
    expect(feed).toHaveLength(MAX_FEED_LENGTH);
    expect(feed[0].id).toBe(`e${MAX_FEED_LENGTH + 4}`);
    expect(pushActivity(feed, feed[0])).toBe(feed);
  });

  it("strips wallet identifiers and exact amounts via the allowlist", () => {
    const out = sanitizeActivity({
      id: "a",
      kind: "withdraw",
      at: 1,
      sizeBucket: "$1k–10k",
      wallet: "GABC",
      address: "GABC",
      amount: "123456",
    });
    expect(out).toEqual({ id: "a", kind: "withdraw", at: 1, sizeBucket: "$1k–10k" });
    expect(JSON.stringify(out)).not.toContain("GABC");
  });

  it("rejects malformed activity and presence", () => {
    expect(sanitizeActivity({ id: "a", kind: "other", at: 1 })).toBeNull();
    expect(sanitizeActivity(null)).toBeNull();
    expect(sanitizePresence({ active: -1 })).toBeNull();
    expect(sanitizePresence({ active: 4.7 })).toBe(4);
  });

  it("expires presence after the idle timeout", () => {
    expect(isPresenceFresh(1000, 1000 + PRESENCE_TTL_MS - 1)).toBe(true);
    expect(isPresenceFresh(1000, 1000 + PRESENCE_TTL_MS)).toBe(false);
    expect(isPresenceFresh(null, 0)).toBe(false);
  });
});

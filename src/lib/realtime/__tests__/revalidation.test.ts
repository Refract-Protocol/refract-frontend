import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRefreshScheduler, tagsForTopic } from "../revalidation";

describe("revalidation", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("maps server-derived topics to tags and ignores client-only topics", () => {
    expect(tagsForTopic("oracle_update")).toContain("oracle");
    expect(tagsForTopic("typing_indicator")).toEqual([]);
  });

  it("coalesces a burst into exactly one refresh", () => {
    const refresh = vi.fn();
    const s = createRefreshScheduler({ refresh, windowMs: 1000 });
    for (let i = 0; i < 20; i++) s.notify("oracle_update");
    s.notify("claim_update");
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0][0]).toEqual(expect.arrayContaining(["oracle", "claims"]));
  });

  it("never refreshes for client-only topics or when disabled", () => {
    const refresh = vi.fn();
    const log = vi.fn();
    createRefreshScheduler({ refresh, windowMs: 10 }).notify("other");
    createRefreshScheduler({ refresh, windowMs: 10, enabled: () => false, log }).notify(
      "oracle_update"
    );
    vi.advanceTimersByTime(100);
    expect(refresh).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("defers while blocked then refreshes once", () => {
    const refresh = vi.fn();
    let blocked = true;
    const s = createRefreshScheduler({ refresh, windowMs: 100, isBlocked: () => blocked });
    s.notify("pool_stats");
    vi.advanceTimersByTime(250);
    expect(refresh).not.toHaveBeenCalled();
    blocked = false;
    vi.advanceTimersByTime(100);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

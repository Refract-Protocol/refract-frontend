import { describe, expect, it } from "vitest";
import { ToastLimiter, type ToastItem } from "./notificationThrottle";

const item = (id: string, priority: ToastItem["priority"] = "normal"): ToastItem => ({ id, priority, title: id });

function make(extra = {}) {
  let t = new Date(2026, 0, 1, 12).getTime();
  const limiter = new ToastLimiter({ maxConcurrent: 3, maxPerWindow: 3, windowMs: 1000, now: () => t, ...extra });
  return { limiter, advance: (ms: number) => (t += ms) };
}

describe("ToastLimiter", () => {
  it("caps the rate and coalesces overflow into a count", () => {
    const { limiter } = make();
    for (let i = 0; i < 10; i++) limiter.push(item(`n${i}`));
    const s = limiter.getState();
    expect(s.visible).toHaveLength(3);
    expect(s.overflow).toBe(7);
  });

  it("never drops critical items and evicts low priority first", () => {
    const { limiter } = make();
    limiter.push(item("a", "low"));
    limiter.push(item("b"));
    limiter.push(item("c"));
    limiter.push(item("settle", "critical"));
    const ids = limiter.getState().visible.map((v) => v.id);
    expect(ids).toContain("settle");
    expect(ids).not.toContain("a");
    expect(limiter.getState().overflow).toBe(1);
  });

  it("allows critical items past the rate cap", () => {
    const { limiter } = make();
    for (let i = 0; i < 5; i++) limiter.push(item(`n${i}`));
    limiter.push(item("claim", "critical"));
    expect(limiter.getState().visible.some((v) => v.id === "claim")).toBe(true);
  });

  it("dedupes identical ids from realtime and REST", () => {
    const { limiter } = make();
    expect(limiter.push(item("x"))).toBe(true);
    expect(limiter.push(item("x"))).toBe(false);
  });

  it("queues non-critical items during quiet hours and shows critical ones", () => {
    const { limiter } = make({ quietHours: { start: 22, end: 14 } });
    limiter.push(item("a"));
    limiter.push(item("b", "critical"));
    expect(limiter.getState().deferred.map((d) => d.id)).toEqual(["a"]);
    expect(limiter.getState().visible.map((d) => d.id)).toEqual(["b"]);
    expect(limiter.flushDeferred()).toHaveLength(1);
  });

  it("resets on account switch", () => {
    const { limiter } = make();
    limiter.push(item("a"));
    limiter.reset();
    expect(limiter.push(item("a"))).toBe(true);
  });
});

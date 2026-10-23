import { describe, expect, it, vi } from "vitest";
import { realtimeLogger, sanitizeRealtimeValue } from "./redact";
import { isNewerUpdate } from "./freshness";

describe("realtime safety boundaries", () => {
  it("redacts nested secrets, bounds unknown values, and removes error messages", () => {
    const result = sanitizeRealtimeValue({
      walletAddress: "GSECRETWALLET",
      rows: [{ authToken: "secret-token", value: "x".repeat(400) }],
      error: new Error("signed payload SECRET"),
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("GSECRETWALLET");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("SECRET");
    expect(serialized).toContain("[truncated]");
  });

  it("only permits demonstrably newer updates past realtime data", () => {
    const realtime = { source: "realtime" as const, sequence: 8, timestamp: 100 };
    expect(isNewerUpdate(realtime, { source: "rest", sequence: 9 })).toBe(true);
    expect(isNewerUpdate(realtime, { source: "rest", sequence: 8 })).toBe(false);
    expect(isNewerUpdate(realtime, { source: "rest", timestamp: 101 })).toBe(true);
    expect(isNewerUpdate(realtime, { source: "rest" })).toBe(false);
  });

  it("routes logs through redaction and keeps debug output disabled by default", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    realtimeLogger.debug("frame", { token: "never-log-this" });
    realtimeLogger.warn("connection", { wallet: "GPRIVATE" });
    expect(debug).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("GPRIVATE");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("never-log-this");
    debug.mockRestore();
    warn.mockRestore();
  });
});

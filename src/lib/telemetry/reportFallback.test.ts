import { beforeEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_REPORT_WINDOW_MS, reportFallback, resetFallbackReports } from "./reportFallback";
import { setAnalyticsProvider } from "@/lib/analytics/track";

const provider = { track: vi.fn() };

beforeEach(() => {
  resetFallbackReports();
  provider.track.mockReset();
  setAnalyticsProvider(provider);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reportFallback", () => {
  it("reports once per hook per rate-limit window", () => {
    for (let i = 0; i < 5; i++) reportFallback("usePoolStats", new Error("down"), 1000 + i);
    expect(provider.track).toHaveBeenCalledTimes(1);
    expect(provider.track).toHaveBeenCalledWith("api_fallback", {
      hook: "usePoolStats",
      errorName: "Error",
      errorMessage: "down",
    });

    reportFallback("usePoolStats", new Error("down"), 1000 + FALLBACK_REPORT_WINDOW_MS);
    expect(provider.track).toHaveBeenCalledTimes(2);
  });

  it("rate-limits each hook independently and handles non-Error values", () => {
    reportFallback("a", "str", 0);
    reportFallback("b", undefined, 0);
    expect(provider.track).toHaveBeenCalledTimes(2);
    expect(provider.track).toHaveBeenLastCalledWith("api_fallback", { hook: "b", errorName: "undefined", errorMessage: "undefined" });
  });

  it("never propagates a telemetry dispatch failure", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("sink down");
    });
    expect(() => reportFallback("x", new Error("down"))).not.toThrow();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { consoleProvider, noopProvider, setAnalyticsProvider, track } from "./track";

afterEach(() => {
  setAnalyticsProvider(noopProvider);
  vi.restoreAllMocks();
});

describe("track", () => {
  it("forwards events and props to the provider", () => {
    const provider = { track: vi.fn() };
    setAnalyticsProvider(provider);
    track("buy_initiated", { coverageType: 1 });
    expect(provider.track).toHaveBeenCalledWith("buy_initiated", { coverageType: 1 });
  });

  it("swallows sync and async provider failures", async () => {
    setAnalyticsProvider({ track: () => { throw new Error("x"); } });
    expect(() => track("buy_failed")).not.toThrow();
    setAnalyticsProvider({ track: () => Promise.reject(new Error("x")) });
    expect(() => track("buy_failed")).not.toThrow();
    await Promise.resolve();
  });

  it("drops events when Do Not Track is enabled", () => {
    const provider = { track: vi.fn() };
    setAnalyticsProvider(provider);
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    track("wallet_connected");
    delete (navigator as { doNotTrack?: string }).doNotTrack;
    expect(provider.track).not.toHaveBeenCalled();
  });

  it("console provider logs the event", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    consoleProvider.track("quote_viewed");
    expect(info).toHaveBeenCalledWith("[analytics]", "quote_viewed", {});
    noopProvider.track("quote_viewed");
  });
});

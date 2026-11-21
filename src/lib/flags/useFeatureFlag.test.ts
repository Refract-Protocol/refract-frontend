import { describe, it, expect, afterEach } from "vitest";
import { useFeatureFlag } from "./useFeatureFlag";

const originalEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalEnv;
});

describe("useFeatureFlag", () => {
  it("returns the configured value for a known flag", () => {
    expect(useFeatureFlag("newDashboard")).toBe(false);
  });

  it("throws for an unknown flag in development", () => {
    process.env.NODE_ENV = "development";
    expect(() => useFeatureFlag("doesNotExist")).toThrow(
      /Unknown feature flag/,
    );
  });

  it("returns false for an unknown flag in production", () => {
    process.env.NODE_ENV = "production";
    expect(useFeatureFlag("doesNotExist")).toBe(false);
  });
});

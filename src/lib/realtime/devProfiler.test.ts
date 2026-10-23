import { describe, expect, it } from "vitest";
import { shouldProfileRealtime } from "./devProfiler";

describe("realtime profiler production guard", () => {
  it("disables measurement for production bundles", async () => {
    expect(shouldProfileRealtime("production")).toBe(false);
    expect(shouldProfileRealtime("development", "1")).toBe(true);
    expect(shouldProfileRealtime("development", undefined)).toBe(false);
  });
});

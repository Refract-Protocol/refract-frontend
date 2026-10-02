import { describe, expect, it } from "vitest";
import { ApiError, ApiUnreachableError } from "@/lib/api/client";
import { queryFnWithFixtureFallback } from "./fixtureFallback";

const fixture = () => ["fixture"];

describe("queryFnWithFixtureFallback", () => {
  it("returns real data when the fetch succeeds", async () => {
    await expect(queryFnWithFixtureFallback(async () => ["real"], fixture)).resolves.toEqual({
      data: ["real"],
      isFixture: false,
      error: null,
    });
  });

  it("falls back to the fixture when the API is unreachable", async () => {
    const result = await queryFnWithFixtureFallback(() => Promise.reject(new ApiUnreachableError(null)), fixture);
    expect(result).toEqual({ data: ["fixture"], isFixture: true, error: null });
  });

  it("passes other errors through as a message by default", async () => {
    const result = await queryFnWithFixtureFallback(() => Promise.reject(new ApiError("boom", 500)), fixture);
    expect(result).toEqual({ data: null, isFixture: false, error: "boom" });
  });

  it("uses the fallback message for non-Error rejections", async () => {
    const result = await queryFnWithFixtureFallback(() => Promise.reject("x"), fixture, { errorMessage: "nope" });
    expect(result.error).toBe("nope");
  });

  it("falls back on any error when asked to", async () => {
    const result = await queryFnWithFixtureFallback(() => Promise.reject(new ApiError("boom", 500)), fixture, {
      fallbackOnAnyError: true,
    });
    expect(result.isFixture).toBe(true);
  });

  it("uses the fixture for empty results when isEmpty matches", async () => {
    const result = await queryFnWithFixtureFallback(async () => [] as string[], fixture, {
      isEmpty: (d) => d.length === 0,
    });
    expect(result).toEqual({ data: ["fixture"], isFixture: true, error: null });
  });

  it("rethrows when the request was cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const err = new ApiUnreachableError(null);
    await expect(
      queryFnWithFixtureFallback(() => Promise.reject(err), fixture, { signal: controller.signal })
    ).rejects.toBe(err);
  });
});

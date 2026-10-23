import { describe, expect, it } from "vitest";
import { parseRealtimeOverride, resolveRealtimeConfig } from "./overrides";

const env = { enabled: true, transport: "ws" as const, endpoint: "wss://api.example/ws" };

describe("realtime override precedence", () => {
  it("parses QA query parameters", () => {
    expect(
      parseRealtimeOverride(
        new URLSearchParams("realtime=sse&realtimeEndpoint=https%3A%2F%2Fmock.test%2Fevents")
      )
    ).toEqual({ mode: "sse", endpoint: "https://mock.test/events" });
  });
  it("lets a remote kill switch win over an allowed override", () => {
    expect(resolveRealtimeConfig(env, { mode: "ws" }, "localhost", true)).toEqual({
      ...env,
      enabled: false,
      transport: "off",
    });
  });
  it("ignores overrides on non-allowlisted production hosts", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(resolveRealtimeConfig(env, { mode: "sse" }, "app.example.com")).toEqual(env);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

import { describe, expect, it } from "vitest";
import { buildRealtimeCsp, isAllowedRealtimeUrl, resolveRealtimeEndpoint } from "./allowlist";

describe("realtime endpoint allowlist", () => {
  it("derives a single websocket origin and CSP connect policy", () => {
    const endpoint = resolveRealtimeEndpoint("https://api.example.com/api/v1");
    expect(endpoint.url).toBe("wss://api.example.com/ws");
    expect(isAllowedRealtimeUrl(endpoint.url, endpoint)).toBe(true);
    expect(isAllowedRealtimeUrl("wss://other.example/ws", endpoint)).toBe(false);
    expect(buildRealtimeCsp(endpoint)).toContain("wss://api.example.com https://api.example.com");
  });
  it("rejects malformed and untrusted origins", () => {
    expect(isAllowedRealtimeUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedRealtimeUrl("wss://attacker.example/socket")).toBe(false);
  });
});

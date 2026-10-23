import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isRealtimeTopicEnabled, sanitizeFlags } from "../flags";
import { REALTIME_TOPICS } from "../protocol";

describe("realtime flags", () => {
  it("requires both the kill switch and the topic flag", () => {
    expect(isRealtimeTopicEnabled({ "realtime-oracle": true }, "oracle")).toBe(false);
    expect(isRealtimeTopicEnabled({ "realtime-enabled": true }, "oracle")).toBe(false);
    expect(
      isRealtimeTopicEnabled({ "realtime-enabled": true, "realtime-oracle": true }, "oracle")
    ).toBe(true);
    expect(
      isRealtimeTopicEnabled({ "realtime-enabled": true, "realtime-oracle": true }, "claims")
    ).toBe(false);
  });

  it("kill switch dominates per-topic flags", () => {
    const all = Object.fromEntries(REALTIME_TOPICS.map((t) => [`realtime-${t}`, true]));
    for (const t of REALTIME_TOPICS)
      expect(isRealtimeTopicEnabled({ ...all, "realtime-enabled": false }, t)).toBe(false);
  });

  it("is safe for missing or malformed documents", () => {
    for (const bad of [undefined, null, "x", 3, [], { "realtime-enabled": "true" }]) {
      expect(isRealtimeTopicEnabled(sanitizeFlags(bad), "oracle")).toBe(false);
    }
    expect(sanitizeFlags({ a: true, b: "yes", c: 1 })).toEqual({ a: true });
  });

  it("committed flags.json keeps every realtime flag off and carries only booleans", () => {
    const { flags } = JSON.parse(readFileSync("public/flags.json", "utf8")) as {
      flags: Record<string, unknown>;
    };
    expect(flags["realtime-enabled"]).toBe(false);
    for (const t of REALTIME_TOPICS) expect(flags[`realtime-${t}`]).toBe(false);
    for (const v of Object.values(flags)) expect(typeof v).toBe("boolean");
  });
});

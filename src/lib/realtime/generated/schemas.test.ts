import { describe, expect, it } from "vitest";
import { ClaimRecordSchema, OracleReadingSchema, RealtimeEnvelopeSchema } from "./schemas";

describe("generated realtime validators", () => {
  it("accepts the optional settlement hash and rejects malformed readings", () => {
    expect(
      ClaimRecordSchema.safeParse({
        policyId: "p1",
        holder: "G...",
        coverageType: 1,
        triggered: true,
        payout: "100",
        reason: "triggered",
        processedAt: 1,
      }).success
    ).toBe(true);
    expect(
      OracleReadingSchema.safeParse({
        coverageType: "StablecoinDepeg",
        type: "oracle_update",
        value: 1,
        threshold: 0.95,
        severity: "invalid",
        message: "bad",
      }).success
    ).toBe(false);
  });

  it("preserves optional, nullable, and nested envelope fields", () => {
    expect(
      RealtimeEnvelopeSchema.safeParse({
        topic: "oracle_update",
        payload: { value: 1 },
        metadata: null,
      }).success
    ).toBe(true);
    expect(
      RealtimeEnvelopeSchema.safeParse({
        topic: "oracle_update",
        payload: { nested: { value: 1 } },
      }).success
    ).toBe(true);
  });
});

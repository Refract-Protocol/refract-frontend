import { describe, expect, it } from "vitest";
import { FIXTURE_ORACLE_READINGS } from "@/lib/fixtures/oracle";
import { FIXTURE_RECENT_CLAIMS } from "@/lib/fixtures/recentClaims";
import { mapClaimUpdate, mapOracleUpdate } from "./index";

describe("realtime domain mappers", () => {
  it("preserves the REST oracle shape and values", () => {
    const restReading = FIXTURE_ORACLE_READINGS[0];
    expect(mapOracleUpdate(restReading)).toEqual({ ok: true, value: restReading });
  });

  it("normalizes claim wire seconds into the REST-derived domain timestamp in milliseconds", () => {
    const restClaim = FIXTURE_RECENT_CLAIMS[0];
    expect(mapClaimUpdate({ ...restClaim, processedAt: restClaim.processedAt / 1000 })).toEqual({
      ok: true,
      value: restClaim,
    });
  });

  it("drops malformed and precision-unsafe claim payloads", () => {
    expect(mapClaimUpdate({ policyId: "1", payout: 1.25 })).toMatchObject({ ok: false });
    expect(
      mapClaimUpdate({
        policyId: "1",
        holder: "G",
        coverageType: 1,
        triggered: true,
        payout: 1250000,
        reason: "trigger",
        processedAt: "2024-01-01",
      })
    ).toMatchObject({ ok: false });
  });
});

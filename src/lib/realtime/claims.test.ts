import { describe, expect, it } from "vitest";
import { mergeClaims, normalizeClaimFrame, type StreamClaim } from "./claims";

const claim = (fields: Partial<StreamClaim> = {}): StreamClaim => ({
  policyId: "policy-1",
  holder: "wallet",
  coverageType: 0,
  triggered: true,
  payout: "100",
  reason: "settled",
  processedAt: 10,
  status: "settled",
  ...fields,
});

describe("claim settlement merge", () => {
  it("normalizes envelope frames and prefers the contract claim id", () => {
    const normalized = normalizeClaimFrame({
      dedupKey: "d1",
      claim: { id: "c1", policy_id: "p1", processed_at: 12, payout: 5 },
    });
    expect(normalized).toMatchObject({ id: "c1", policyId: "p1", processedAt: 12, dedupKey: "d1" });
  });

  it("inserts newest pushed rows and deduplicates replay against REST pages", () => {
    const rows = mergeClaims(
      [claim({ id: "old", processedAt: 1 })],
      [claim({ id: "new", processedAt: 3 }), claim({ id: "new", processedAt: 3 })]
    );
    expect(rows.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("updates a known pending claim and ignores a regressive replay after terminal settlement", () => {
    const pending = claim({ status: "pending", triggered: false, processedAt: 2 });
    const settled = claim({ status: "settled", processedAt: 4, payout: "200" });
    expect(mergeClaims([pending], [settled])[0]?.payout).toBe("200");
    expect(
      mergeClaims([settled], [claim({ status: "pending", triggered: false, processedAt: 3 })])[0]
        ?.status
    ).toBe("settled");
  });

  it("reconciles a pushed row when a later REST page returns it", () => {
    const pushed = claim({ id: "claim-1", processedAt: 20 });
    expect(mergeClaims([pushed], [pushed])).toHaveLength(1);
  });
});

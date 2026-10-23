import { describe, expect, it } from "vitest";
import { parsePolicyEvent } from "./policyEvents";
import { policyTopic } from "./topics";

const HOLDER = "GABC";

describe("parsePolicyEvent", () => {
  it("parses each event type", () => {
    const base = { holder: HOLDER, ts: 1_700_000_000_000 };
    expect(parsePolicyEvent({ ...base, type: "accepted", txHash: "tx1" })?.type).toBe("accepted");
    expect(parsePolicyEvent({ ...base, type: "issued", txHash: "tx1", policyId: "p1" })?.type).toBe(
      "issued"
    );
    expect(
      parsePolicyEvent({ ...base, type: "premium_charged", policyId: "p1", amount: "10" })?.type
    ).toBe("premium_charged");
    expect(
      parsePolicyEvent({ ...base, type: "cancelled", policyId: "p1", reason: "expired" })?.type
    ).toBe("cancelled");
    expect(
      parsePolicyEvent({ ...base, type: "failed", txHash: "tx1", reason: "tx_failed" })?.type
    ).toBe("failed");
  });

  it("returns null for malformed payloads", () => {
    expect(parsePolicyEvent(null)).toBeNull();
    expect(parsePolicyEvent({ type: "issued", holder: HOLDER, ts: 1 })).toBeNull(); // missing ids
    expect(parsePolicyEvent({ type: "teleported", holder: HOLDER, ts: 1, txHash: "x" })).toBeNull();
    expect(
      parsePolicyEvent({ type: "cancelled", holder: HOLDER, ts: 1, policyId: "p", reason: "bored" })
    ).toBeNull();
    expect(parsePolicyEvent({ type: "accepted", holder: HOLDER, ts: -5, txHash: "x" })).toBeNull();
  });
});

describe("policyTopic", () => {
  it("keys the topic by wallet address", () => {
    expect(policyTopic("GXYZ")).toBe("policy.GXYZ");
  });
});

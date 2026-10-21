import { describe, expect, it } from "vitest";
import {
  addOptimistic,
  applyPolicyEvent,
  findInFlightDuplicate,
  settleViaRest,
  type PendingPolicy,
} from "./pendingPolicies";
import type { PolicyEvent } from "./policyEvents";

const HOLDER = "GHOLDER";
const NOW = 1_700_000_000_000;

const optimistic = (list: PendingPolicy[] = [], txHash = "tx1") =>
  addOptimistic(
    list,
    {
      txHash,
      holder: HOLDER,
      policyId: "p1",
      coverageType: 1,
      coverageTypeName: "Depeg",
      coverageAmount: "50000000000",
    },
    NOW
  );

const ev = (e: Record<string, unknown>) =>
  ({ holder: HOLDER, ts: NOW + 1_000, ...e }) as PolicyEvent;

describe("pending policy transitions", () => {
  it("optimistic → accepted → active (confirmed)", () => {
    let list = optimistic();
    expect(list[0]).toMatchObject({ key: "tx1", status: "submitted" });

    list = applyPolicyEvent(list, ev({ type: "accepted", txHash: "tx1" }), NOW + 1);
    expect(list[0]!.status).toBe("accepted");

    list = applyPolicyEvent(
      list,
      ev({ type: "issued", txHash: "tx1", policyId: "p1", ts: NOW + 2_000 }),
      NOW + 2
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      status: "active",
      confirmedBy: "realtime",
      lastEventTs: NOW + 2_000,
    });
  });

  it("optimistic → failed rolls the entry back", () => {
    let list = optimistic();
    list = applyPolicyEvent(
      list,
      ev({ type: "failed", txHash: "tx1", reason: "tx_bad_seq" }),
      NOW + 1
    );
    expect(list[0]).toMatchObject({ status: "failed", reason: "tx_bad_seq" });
  });

  it("never moves backwards (duplicates and out-of-order delivery)", () => {
    let list = optimistic();
    list = applyPolicyEvent(list, ev({ type: "issued", txHash: "tx1", policyId: "p1" }), NOW + 1);
    const settled = list;
    list = applyPolicyEvent(list, ev({ type: "accepted", txHash: "tx1" }), NOW + 2);
    list = applyPolicyEvent(list, ev({ type: "issued", txHash: "tx1", policyId: "p1" }), NOW + 3);
    list = applyPolicyEvent(list, ev({ type: "failed", txHash: "tx1", reason: "late" }), NOW + 4);
    expect(list).toBe(settled);
  });

  it("cancellation after issuance", () => {
    let list = optimistic();
    list = applyPolicyEvent(list, ev({ type: "issued", txHash: "tx1", policyId: "p1" }), NOW + 1);
    list = applyPolicyEvent(
      list,
      ev({ type: "cancelled", policyId: "p1", reason: "pool_insufficient" }),
      NOW + 2
    );
    expect(list[0]).toMatchObject({ status: "cancelled", reason: "pool_insufficient" });
  });

  it("records premium charges by policy id", () => {
    let list = optimistic();
    list = applyPolicyEvent(
      list,
      ev({ type: "premium_charged", policyId: "p1", amount: "1230000" }),
      NOW + 1
    );
    expect(list[0]!.premiumCharged).toBe("1230000");
  });

  it("does not duplicate a row when the same purchase is added twice (other tab, retry)", () => {
    let list = optimistic();
    list = optimistic(list);
    expect(list).toHaveLength(1);
  });

  it("merges when the issuance event beats the REST response", () => {
    let list = applyPolicyEvent([], ev({ type: "issued", txHash: "tx1", policyId: "p1" }), NOW);
    expect(list[0]).toMatchObject({ status: "active", external: true });
    list = optimistic(list);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "active", external: false, coverageTypeName: "Depeg" });
  });

  it("shows policies issued outside this session", () => {
    const list = applyPolicyEvent(
      optimistic(),
      ev({ type: "issued", txHash: "tx-elsewhere", policyId: "p9" }),
      NOW
    );
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ key: "tx-elsewhere", status: "active", external: true });
  });

  it("ignores failure/cancel events for unknown policies", () => {
    const list = optimistic();
    expect(applyPolicyEvent(list, ev({ type: "failed", txHash: "nope", reason: "x" }), NOW)).toBe(
      list
    );
    expect(
      applyPolicyEvent(list, ev({ type: "cancelled", policyId: "nope", reason: "expired" }), NOW)
    ).toBe(list);
  });

  it("falls back to the REST result after the bounded wait", () => {
    let list = optimistic();
    list = settleViaRest(list, "tx1", NOW + 90_000);
    expect(list[0]).toMatchObject({ status: "active", confirmedBy: "rest" });
    // A late issuance event upgrades the confirmation source.
    list = applyPolicyEvent(
      list,
      ev({ type: "issued", txHash: "tx1", policyId: "p1" }),
      NOW + 91_000
    );
    expect(list[0]).toMatchObject({ status: "active", confirmedBy: "realtime" });
  });

  it("detects an identical in-flight purchase", () => {
    const list = optimistic();
    const params = { holder: HOLDER, coverageType: 1, coverageAmount: "50000000000" };
    expect(findInFlightDuplicate(list, params)?.key).toBe("tx1");
    expect(findInFlightDuplicate(list, { ...params, coverageAmount: "1" })).toBeUndefined();
    const settled = settleViaRest(list, "tx1", NOW);
    expect(findInFlightDuplicate(settled, params)).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import type { ClaimRecord } from "@/lib/api/claims";
import type { OracleReading } from "@/lib/api/oracle";
import type { PoolStats } from "@/lib/api/pool";
import type { RefractNotification } from "@/lib/notifications";
import {
  claimsSettlementMerger,
  createCollectionMerger,
  notificationsMerger,
  oracleReadingsMerger,
  poolStatsMerger,
  type RealtimeMergeEnvelope,
} from "./merge";

const initialOracleReadings: OracleReading[] = [
  {
    coverageType: "USDC Depeg",
    type: "oracle_update",
    value: 0.999,
    threshold: 0.95,
    severity: "low",
    message: "Stable",
  },
  {
    coverageType: "Flight Delay",
    type: "oracle_update",
    value: 15,
    threshold: 120,
    severity: "low",
    message: "Normal",
  },
];

describe("Unified Realtime/REST Merge Layer", () => {
  it("applies updates idempotently and ignores duplicate event IDs", () => {
    let state = oracleReadingsMerger.fromSnapshot(initialOracleReadings, 1_000);

    const event: RealtimeMergeEnvelope<OracleReading> = {
      id: "evt-1",
      seq: 1,
      ts: 1_500,
      type: "delta",
      payload: {
        coverageType: "USDC Depeg",
        type: "oracle_update",
        value: 0.941,
        threshold: 0.95,
        severity: "triggered",
        message: "Depeg threshold breached",
      },
    };

    const afterFirst = oracleReadingsMerger.applyEvent(state, event);
    const afterDuplicate = oracleReadingsMerger.applyEvent(afterFirst, event);

    expect(afterDuplicate).toBe(afterFirst);
    expect(afterFirst.data).toHaveLength(2);
    expect(afterFirst.data[0].value).toBe(0.941);
    expect(afterFirst.data[0].severity).toBe("triggered");
    expect(afterFirst.lastSeq).toBe(1);
    expect(afterFirst.lastEventAt).toBe(1_500);
  });

  it("drops out-of-order stale events for the same entity while accepting newer events", () => {
    let state = oracleReadingsMerger.fromSnapshot(initialOracleReadings, 1_000);

    const newerEvent: RealtimeMergeEnvelope<OracleReading> = {
      id: "evt-seq-5",
      seq: 5,
      ts: 5_000,
      payload: {
        coverageType: "USDC Depeg",
        type: "oracle_update",
        value: 0.985,
        threshold: 0.95,
        severity: "medium",
        message: "Recovering",
      },
    };

    const olderEvent: RealtimeMergeEnvelope<OracleReading> = {
      id: "evt-seq-3",
      seq: 3,
      ts: 3_000,
      payload: {
        coverageType: "USDC Depeg",
        type: "oracle_update",
        value: 0.91,
        threshold: 0.95,
        severity: "triggered",
        message: "Old triggered frame",
      },
    };

    state = oracleReadingsMerger.applyEvent(state, newerEvent);
    const afterStale = oracleReadingsMerger.applyEvent(state, olderEvent);

    expect(afterStale).toBe(state);
    expect(afterStale.data.find((r) => r.coverageType === "USDC Depeg")?.value).toBe(0.985);
  });

  it("inserts entities missing from the initial snapshot and supports remove tombstones", () => {
    const merger = createCollectionMerger<{ id: string; label: string }>({
      getItemKey: (item) => item.id,
      getPayloadKey: (payload) => payload.id,
      toItem: (payload) => payload,
      compare: (a, b) => a.id.localeCompare(b.id),
    });

    let state = merger.fromSnapshot([{ id: "a", label: "Alpha" }], 100);

    state = merger.applyEvent(state, {
      id: "ins-b",
      seq: 1,
      ts: 200,
      type: "event",
      payload: { id: "b", label: "Beta" },
    });
    expect(state.data.map((i) => i.id)).toEqual(["a", "b"]);

    state = merger.applyEvent(state, {
      id: "rem-a",
      seq: 2,
      ts: 300,
      type: "remove",
      payload: { id: "a", label: "Alpha" },
    });
    expect(state.data.map((i) => i.id)).toEqual(["b"]);
  });

  it("rebases on a late REST snapshot without clobbering fresher realtime state", () => {
    let state = oracleReadingsMerger.fromSnapshot(initialOracleReadings, 1_000);

    state = oracleReadingsMerger.applyEvent(state, {
      id: "evt-fresh",
      seq: 10,
      ts: 5_000,
      payload: {
        coverageType: "USDC Depeg",
        type: "oracle_update",
        value: 0.96,
        threshold: 0.95,
        severity: "high",
        message: "Elevated volatility",
      },
    });

    const staleRestSnapshot: OracleReading[] = [
      {
        coverageType: "USDC Depeg",
        type: "oracle_update",
        value: 0.999,
        threshold: 0.95,
        severity: "low",
        message: "Stale REST value",
      },
      {
        coverageType: "Smart Contract Exploit",
        type: "oracle_update",
        value: 0,
        threshold: 1,
        severity: "low",
        message: "No exploit detected",
      },
    ];

    const rebased = oracleReadingsMerger.rebaseSnapshot(state, staleRestSnapshot, 3_000);
    expect(rebased.data.find((r) => r.coverageType === "USDC Depeg")?.value).toBe(0.96);
    expect(rebased.data.find((r) => r.coverageType === "Smart Contract Exploit")?.value).toBe(0);
  });

  it("preserves local read state in notificationsMerger and orders claims/pool stats deterministically", () => {
    const initialNotifications: RefractNotification[] = [
      {
        id: "notif-1",
        type: "claim_payout",
        title: "Claim Payout",
        message: "Paid",
        timestamp: 1_000,
        read: true,
        severity: "success",
      },
    ];

    let notifState = notificationsMerger.fromSnapshot(initialNotifications, 1_000);
    notifState = notificationsMerger.applyEvent(notifState, {
      id: "evt-notif-1",
      seq: 2,
      ts: 2_000,
      payload: {
        id: "notif-1",
        type: "claim_payout",
        title: "Claim Payout Disbursed",
        message: "Paid on-chain",
        timestamp: 1_000,
        read: false,
        severity: "success",
      },
    });

    expect(notifState.data[0].read).toBe(true);
    expect(notifState.data[0].message).toBe("Paid on-chain");

    const basePool: PoolStats = {
      totalUsdc: "1000",
      totalShares: "1000",
      lockedUsdc: "200",
      premiumAccrued: "50",
      availableUsdc: "800",
      utilizationBps: 2000,
      apyBps: 500,
      sharePrice: 1.05,
      maxUtilizationBps: 8000,
    };

    let poolState = poolStatsMerger.fromSnapshot(basePool, 1_000);
    poolState = poolStatsMerger.applyEvent(poolState, {
      id: "pool-1",
      seq: 4,
      ts: 2_000,
      payload: { utilizationBps: 3100, sharePrice: 1.07 },
    });
    expect(poolState.data.utilizationBps).toBe(3100);
    expect(poolState.data.sharePrice).toBe(1.07);
  });

  it("satisfies idempotency and convergence across shuffled duplicate claim event streams", () => {
    const baseClaims: ClaimRecord[] = [
      {
        policyId: "pol-1",
        holder: "GAAA",
        coverageType: 0,
        triggered: false,
        payout: "0",
        reason: "Initial check",
        processedAt: 100,
      },
    ];

    const stream: RealtimeMergeEnvelope<ClaimRecord>[] = [
      {
        id: "c-1",
        seq: 1,
        ts: 1_100,
        payload: {
          policyId: "pol-1",
          holder: "GAAA",
          coverageType: 0,
          triggered: true,
          payout: "500000000",
          reason: "Triggered v1",
          processedAt: 100,
        },
      },
      {
        id: "c-2",
        seq: 2,
        ts: 1_200,
        payload: {
          policyId: "pol-1",
          holder: "GAAA",
          coverageType: 0,
          triggered: true,
          payout: "500000000",
          reason: "Settled on-chain",
          processedAt: 100,
          settlementTxHash: "tx_hash_final",
        },
      },
      {
        id: "c-3",
        seq: 3,
        ts: 1_300,
        payload: {
          policyId: "pol-2",
          holder: "GBBB",
          coverageType: 1,
          triggered: true,
          payout: "900000000",
          reason: "Flight cancelled",
          processedAt: 250,
        },
      },
    ];

    const canonical = claimsSettlementMerger.applyEvents(
      claimsSettlementMerger.fromSnapshot(baseClaims, 1_000),
      stream,
    );

    const shuffledWithDuplicates: RealtimeMergeEnvelope<ClaimRecord>[] = [
      stream[2],
      stream[1],
      stream[0],
      stream[2],
      stream[1],
      stream[0],
    ];

    const converged = claimsSettlementMerger.applyEvents(
      claimsSettlementMerger.fromSnapshot(baseClaims, 1_000),
      shuffledWithDuplicates,
    );

    expect(converged.data).toEqual(canonical.data);
    expect(converged.data).toHaveLength(2);
    expect(converged.data[0].policyId).toBe("pol-2");
    expect(converged.data[1].settlementTxHash).toBe("tx_hash_final");
  });
});

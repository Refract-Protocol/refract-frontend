import { describe, expect, it, vi } from "vitest";
import { InboundMessageValidator } from "./message";

describe("InboundMessageValidator & Runtime Schema Parsing", () => {
  it("validates well-formed frames across all canonical topics and preserves extra fields", () => {
    const validator = new InboundMessageValidator({ warn: () => {} });

    const oracleResult = validator.parseRawFrame(
      JSON.stringify({
        v: 1,
        id: "evt_1",
        topic: "oracle.readings",
        type: "delta",
        seq: 12,
        ts: 1730000000000,
        payload: {
          coverageType: "USDC Depeg",
          type: "oracle_update",
          value: 0.999,
          threshold: 0.95,
          severity: "low",
          message: "Stable",
          extraField: "forward-compatible",
        },
      }),
    );

    expect(oracleResult.ok).toBe(true);
    if (oracleResult.ok) {
      expect(oracleResult.frame.topic).toBe("oracle.readings");
      expect((oracleResult.frame.payload as Record<string, unknown>).extraField).toBe(
        "forward-compatible",
      );
    }

    const claimResult = validator.parseRawFrame({
      v: 1,
      topic: "claims.settlement",
      payload: {
        policyId: "pol-1",
        holder: "GABC",
        coverageType: 1,
        triggered: true,
        payout: "10000000",
        reason: "Delayed",
        processedAt: 1730000000,
      },
    });
    expect(claimResult.ok).toBe(true);

    const diagnostics = validator.getDiagnostics();
    expect(diagnostics.validCount).toBe(2);
    expect(diagnostics.droppedCount).toBe(0);
    expect(diagnostics.protocolIncompatible).toBe(false);
  });

  it("drops malformed JSON, missing fields, wrong types, and unknown topics while incrementing counters", () => {
    const warnings: string[] = [];
    let currentTime = 1_000;
    const validator = new InboundMessageValidator({
      warn: (m) => warnings.push(m),
      warnIntervalMs: 5_000,
      now: () => currentTime,
    });

    expect(validator.parseRawFrame("{broken-json").ok).toBe(false);
    expect(validator.parseRawFrame({ v: 1, topic: "unknown.topic", payload: {} }).ok).toBe(false);
    expect(
      validator.parseRawFrame({
        v: 1,
        topic: "oracle.readings",
        payload: {
          coverageType: "USDC Depeg",
          type: "oracle_update",
          value: "not-a-number",
          threshold: 0.95,
          severity: "low",
        },
      }).ok,
    ).toBe(false);

    const diag = validator.getDiagnostics();
    expect(diag.droppedCount).toBe(3);
    expect(diag.failureCountsByReason.invalid_json).toBe(1);
    expect(diag.failureCountsByReason.unknown_topic).toBe(1);
    expect(diag.failureCountsByReason.invalid_payload).toBe(1);

    // Rate-limited warning: only 1 warning emitted within the 5000ms window
    expect(warnings).toHaveLength(1);

    currentTime += 6_000;
    validator.parseRawFrame("{still-broken");
    expect(warnings).toHaveLength(2);
    expect(warnings[1]).toContain("+2 suppressed warnings");
  });

  it("marks the transport protocolIncompatible when a major version mismatch is received", () => {
    const warn = vi.fn();
    const validator = new InboundMessageValidator({ warn });

    const res = validator.parseRawFrame({
      v: 2,
      topic: "oracle.readings",
      payload: {
        coverageType: "USDC Depeg",
        type: "oracle_update",
        value: 1,
        threshold: 0.95,
        severity: "low",
        message: "ok",
      },
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("version_mismatch");
    }

    const diag = validator.getDiagnostics();
    expect(diag.protocolIncompatible).toBe(true);
    expect(diag.incompatibleVersionSeen).toBe(2);
    expect(diag.failureCountsByReason.version_mismatch).toBe(1);
  });

  it("validates 1,000 high-frequency oracle frames well within the runtime budget (<250ms)", () => {
    const validator = new InboundMessageValidator({ warn: () => {} });
    const rawFrame = JSON.stringify({
      v: 1,
      id: "evt_stress",
      topic: "oracle.readings",
      type: "delta",
      seq: 1,
      ts: 1730000000000,
      payload: {
        coverageType: "USDC Depeg",
        type: "oracle_update",
        value: 0.9994,
        threshold: 0.95,
        severity: "low",
        message: "Normal",
      },
    });

    const start = performance.now();
    for (let i = 0; i < 1_000; i += 1) {
      const res = validator.parseRawFrame(rawFrame);
      if (!res.ok) throw new Error("Expected frame to be valid");
    }
    const elapsedMs = performance.now() - start;

    expect(validator.getDiagnostics().validCount).toBe(1_000);
    expect(elapsedMs).toBeLessThan(250);
  });
});

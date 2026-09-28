import { describe, expectTypeOf, it } from "vitest";
import type { Policy, RiskLevel } from "../policies";
import type { PoolStats, LockupStatus } from "../pool";
import type { OracleReading } from "../oracle";
import type { ClaimRecord } from "../claims";
import type { SubmitTxResult } from "../tx";

// Type-level checks that the generated types keep the shapes existing call sites rely on.
describe("generated API types", () => {
  it("stay structurally compatible with current usage", () => {
    expectTypeOf<RiskLevel>().toEqualTypeOf<"low" | "medium" | "high" | "critical">();
    expectTypeOf<Policy["coverageAmount"]>().toEqualTypeOf<string>();
    expectTypeOf<Policy["isActive"]>().toEqualTypeOf<boolean>();
    expectTypeOf<PoolStats["apyBps"]>().toEqualTypeOf<number>();
    expectTypeOf<LockupStatus["lockupExpiresAt"]>().toEqualTypeOf<string | null>();
    expectTypeOf<OracleReading["severity"]>().toEqualTypeOf<"low" | "medium" | "high" | "triggered">();
    expectTypeOf<ClaimRecord["settlementTxHash"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<SubmitTxResult["confirmed"]>().toEqualTypeOf<boolean>();
  });
});

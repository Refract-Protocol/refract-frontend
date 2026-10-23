import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseOptimisticEvent,
  registerOptimisticAction,
  resolveOptimisticAction,
} from "./optimisticReconciliation";

describe("optimistic action reconciliation", () => {
  afterEach(() => vi.useRealTimers());

  it("confirms or amends an action once and ignores replayed confirmations", () => {
    const onConfirm = vi.fn();
    registerOptimisticAction({
      correlationId: "confirm-1",
      kind: "buy",
      onConfirm,
      onRollback: vi.fn(),
      verify: vi.fn(),
    });
    const event = parseOptimisticEvent({
      correlationId: "confirm-1",
      outcome: "amended",
      authoritative: { amount: 12 },
    });
    expect(event && resolveOptimisticAction(event)).toBe(true);
    expect(event && resolveOptimisticAction(event)).toBe(false);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledWith({ amount: 12 });
  });

  it("rolls back rejected actions idempotently", () => {
    const onRollback = vi.fn();
    registerOptimisticAction({
      correlationId: "reject-1",
      kind: "provide",
      onConfirm: vi.fn(),
      onRollback,
      verify: vi.fn(),
    });
    const event = { correlationId: "reject-1", outcome: "rejected" as const, reason: "capacity" };
    expect(resolveOptimisticAction(event)).toBe(true);
    expect(resolveOptimisticAction(event)).toBe(false);
    expect(onRollback).toHaveBeenCalledOnce();
    expect(onRollback).toHaveBeenCalledWith("capacity");
  });

  it("uses REST verification after the pending timeout", async () => {
    vi.useFakeTimers();
    const verify = vi.fn().mockResolvedValue("rejected");
    const rollback = vi.fn();
    registerOptimisticAction({
      correlationId: "timeout-1",
      kind: "withdraw",
      onConfirm: vi.fn(),
      onRollback: rollback,
      verify,
    });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(verify).toHaveBeenCalledOnce();
    expect(rollback).toHaveBeenCalledOnce();
  });
});

import { describe, it, expect } from "vitest";
import { validatePoolAction } from "./pool";

describe("Pool Validation Schema", () => {
  it("validates deposit amounts", () => {
    const bounds = {
      tab: "deposit" as const,
      availableToWithdraw: 1000,
      isLocked: false,
      isConnected: true,
    };

    expect(validatePoolAction("500", bounds).isValid).toBe(true);
    expect(validatePoolAction(10000, bounds).isValid).toBe(true);
    expect(validatePoolAction("0", bounds).isValid).toBe(false);
    expect(validatePoolAction("-50", bounds).isValid).toBe(false);
  });

  it("validates withdrawal limits and lockups", () => {
    const bounds = {
      tab: "withdraw" as const,
      availableToWithdraw: 1500,
      isLocked: false,
      isConnected: true,
    };

    // Valid within balance
    expect(validatePoolAction("1500", bounds).isValid).toBe(true);
    expect(validatePoolAction("500", bounds).isValid).toBe(true);

    // Exceeds available balance
    const exceeds = validatePoolAction("1501", bounds);
    expect(exceeds.isValid).toBe(false);
    expect(exceeds.amountError).toBe("You only have $1,500.00 available to withdraw");

    // Locked status
    const lockedBounds = { ...bounds, isLocked: true };
    const lockedResult = validatePoolAction("500", lockedBounds);
    expect(lockedResult.isValid).toBe(false);
    expect(lockedResult.isLockedError).toBe(true);
  });
});

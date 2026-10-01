import { describe, it, expect } from "vitest";
import { deriveNotifications, ONE_DAY_MS, SEVEN_DAYS_MS } from "./notifications";
import type { Policy } from "./api/policies";
import type { ClaimRecord } from "./api/claims";
import type { OracleReading } from "./api/oracle";

describe("deriveNotifications", () => {
  const now = 1700000000000;

  it("identifies policies expiring within 7 days", () => {
    const mockPolicies: Policy[] = [
      {
        id: "pol-1",
        holder: "GBEXAMPLE",
        coverageType: 1,
        coverageTypeName: "Stablecoin Depeg",
        coverageAmount: "50000000000",
        premium: "100000000",
        durationDays: 30,
        expiresAt: Math.floor((now + 3 * ONE_DAY_MS) / 1000), // 3 days remaining
        isActive: true,
        createdAt: new Date(now - 27 * ONE_DAY_MS).toISOString(),
      },
      {
        id: "pol-2",
        holder: "GBEXAMPLE",
        coverageType: 2,
        coverageTypeName: "Market Crash",
        coverageAmount: "10000000000",
        premium: "100000000",
        durationDays: 60,
        expiresAt: Math.floor((now + 20 * ONE_DAY_MS) / 1000), // 20 days remaining (should not trigger)
        isActive: true,
        createdAt: new Date(now - 40 * ONE_DAY_MS).toISOString(),
      },
    ];

    const notifs = deriveNotifications({ policies: mockPolicies, now });
    expect(notifs.length).toBe(1);
    expect(notifs[0].type).toBe("policy_expiring");
    expect(notifs[0].title).toBe("Policy Expiring Soon");
    expect(notifs[0].message).toContain("3 days");
  });

  it("creates notifications for claims and payouts", () => {
    const mockClaims: ClaimRecord[] = [
      {
        policyId: "pol-1",
        holder: "GBEXAMPLE",
        coverageType: 1,
        triggered: true,
        payout: "50000000000",
        reason: "USDC depegged below $0.98",
        processedAt: Math.floor((now - 3600000) / 1000),
      },
    ];

    const notifs = deriveNotifications({ claims: mockClaims, now });
    expect(notifs.length).toBe(1);
    expect(notifs[0].type).toBe("claim_payout");
    expect(notifs[0].title).toBe("Claim Payout Disbursed");
  });

  it("handles lockup expiration and active oracle triggers", () => {
    const lockupExpiresAt = Math.floor((now - 1000) / 1000); // Expired
    const mockReadings: OracleReading[] = [
      {
        coverageType: "Flight Delay",
        type: "oracle_update",
        value: 140,
        threshold: 120,
        severity: "triggered",
        message: "Flight BA249 delayed 140 min",
      },
    ];

    const notifs = deriveNotifications({ lockupExpiresAt, oracleReadings: mockReadings, now });
    expect(notifs.length).toBe(2);
    expect(notifs.some((n) => n.type === "lockup_expired")).toBe(true);
    expect(notifs.some((n) => n.type === "oracle_trigger")).toBe(true);
  });

  it("marks read status correctly based on readIds set", () => {
    const mockClaims: ClaimRecord[] = [
      {
        policyId: "pol-1",
        holder: "GBEXAMPLE",
        coverageType: 1,
        triggered: true,
        payout: "50000000000",
        reason: "USDC depegged",
        processedAt: Math.floor(now / 1000),
      },
    ];

    const readIds = new Set([`claim-pol-1-${Math.floor(now / 1000)}`]);
    const notifs = deriveNotifications({ claims: mockClaims, now, readIds });
    expect(notifs[0].read).toBe(true);
  });
});

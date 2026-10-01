import type { Policy } from "./api/policies";
import type { ClaimRecord } from "./api/claims";
import type { OracleReading } from "./api/oracle";
import { formatUsd, fromStroops } from "./format";

export type NotificationType =
  | "policy_expiring"
  | "claim_payout"
  | "lockup_expired"
  | "lockup_soon"
  | "oracle_trigger";

export interface RefractNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  href?: string;
  severity: "info" | "warning" | "success" | "critical";
}

export interface DeriveNotificationsParams {
  policies?: Policy[] | null;
  claims?: ClaimRecord[] | null;
  lockupExpiresAt?: number | null;
  oracleReadings?: OracleReading[] | null;
  now?: number;
  readIds?: Set<string>;
}

export const SEVEN_DAYS_MS = 7 * 86400 * 1000;
export const ONE_DAY_MS = 86400 * 1000;

export function deriveNotifications({
  policies = [],
  claims = [],
  lockupExpiresAt = null,
  oracleReadings = [],
  now = Date.now(),
  readIds = new Set<string>(),
}: DeriveNotificationsParams): RefractNotification[] {
  const notifications: RefractNotification[] = [];

  // 1. Policy Expiry Warnings (within 7 days)
  if (policies) {
    for (const policy of policies) {
      if (!policy.isActive) continue;
      const expiryMs = policy.expiresAt * 1000;
      const timeRemaining = expiryMs - now;

      if (timeRemaining > 0 && timeRemaining <= SEVEN_DAYS_MS) {
        const days = Math.max(1, Math.ceil(timeRemaining / ONE_DAY_MS));
        const id = `policy-exp-${policy.id}`;
        notifications.push({
          id,
          type: "policy_expiring",
          title: `Policy Expiring Soon`,
          message: `Your ${policy.coverageTypeName} policy (${formatUsd(
            fromStroops(policy.coverageAmount)
          )}) expires in ${days} day${days > 1 ? "s" : ""}.`,
          timestamp: expiryMs - SEVEN_DAYS_MS,
          read: readIds.has(id),
          href: "/dashboard",
          severity: days <= 2 ? "critical" : "warning",
        });
      }
    }
  }

  // 2. Claim Payouts
  if (claims) {
    for (const claim of claims) {
      if (claim.triggered) {
        const id = `claim-${claim.policyId}-${claim.processedAt}`;
        const payoutFormatted = formatUsd(fromStroops(claim.payout));
        notifications.push({
          id,
          type: "claim_payout",
          title: `Claim Payout Disbursed`,
          message: `${payoutFormatted} was automatically disbursed for policy ${claim.policyId.slice(0, 8)}… (${claim.reason}).`,
          timestamp: claim.processedAt * 1000,
          read: readIds.has(id),
          href: "/dashboard",
          severity: "success",
        });
      }
    }
  }

  // 3. Lockup Status
  if (lockupExpiresAt !== null && lockupExpiresAt > 0) {
    const lockupMs = lockupExpiresAt * 1000;
    if (lockupMs <= now) {
      const id = `lockup-expired-${lockupExpiresAt}`;
      notifications.push({
        id,
        type: "lockup_expired",
        title: "Capital Lockup Ended",
        message: "Your liquidity pool deposit lockup has ended. Funds are now available for withdrawal.",
        timestamp: lockupMs,
        read: readIds.has(id),
        href: "/provide",
        severity: "info",
      });
    } else if (lockupMs - now <= ONE_DAY_MS) {
      const id = `lockup-soon-${lockupExpiresAt}`;
      notifications.push({
        id,
        type: "lockup_soon",
        title: "Capital Lockup Ending Soon",
        message: "Your liquidity provider lockup will expire in less than 24 hours.",
        timestamp: lockupMs - ONE_DAY_MS,
        read: readIds.has(id),
        href: "/provide",
        severity: "info",
      });
    }
  }

  // 4. Oracle Triggers
  if (oracleReadings) {
    for (const reading of oracleReadings) {
      if (reading.severity === "triggered" || reading.severity === "high") {
        const id = `oracle-trig-${reading.coverageType}-${reading.value}`;
        notifications.push({
          id,
          type: "oracle_trigger",
          title: reading.severity === "triggered" ? `Oracle Trigger Activated` : `Oracle Alert: Elevated Risk`,
          message: `${reading.coverageType}: ${reading.message}`,
          timestamp: now,
          read: readIds.has(id),
          href: "/dashboard",
          severity: reading.severity === "triggered" ? "critical" : "warning",
        });
      }
    }
  }

  // Sort descending by timestamp
  return notifications.sort((a, b) => b.timestamp - a.timestamp);
}

/** Stable frontend shapes shared by REST responses and realtime events. */
export interface OracleReading {
  coverageType: string;
  type: "oracle_update";
  value: number;
  threshold: number;
  severity: "low" | "medium" | "high" | "triggered";
  message: string;
}

export interface ClaimRecord {
  policyId: string;
  holder: string;
  coverageType: number;
  triggered: boolean;
  /** Base-unit amount, kept as a string to preserve integer precision. */
  payout: string;
  reason: string;
  /** Unix timestamp in milliseconds, the shared frontend representation. */
  processedAt: number;
  settlementTxHash?: string;
}

export interface NotificationEvent {
  id: string;
  message: string;
  /** Unix timestamp in milliseconds. */
  timestamp: number;
}

/**
 * Realtime policy event. Carries the affected policy id so consumers can patch
 * the cached list in place instead of invalidating and refetching it.
 */
export interface PolicyRealtimeEvent {
  type: "policy_update";
  policyId: string;
  /** Partial policy fields to merge into the cached entry. */
  changes?: Record<string, unknown>;
}

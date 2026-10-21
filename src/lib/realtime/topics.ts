/**
 * Canonical realtime topic constants and their TanStack Query-key mappings.
 *
 * The backend WebSocket pushes `{ topic, payload }` messages. Each topic
 * corresponds to a REST endpoint whose cached result should be invalidated
 * when a push arrives, so the rendered data refreshes without a manual
 * refetch. Topic names are kept short to stay under the WS frame budget.
 *
 * Buffer caps are documented per topic — high-frequency oracle readings get
 * a larger cap than low-frequency claim settlements.
 */

/** Realtime topic string identifiers pushed by the backend. */
export const REALTIME_TOPICS = {
  /** Oracle price/threshold update for a coverage type. */
  oracleUpdate: "oracle_update",
  /** A claim was settled (payout disbursed). */
  claimSettled: "claim_settled",
  /** Pool stats changed (TVL, utilization, APY). */
  poolStatsUpdate: "pool_stats_update",
  /** A new policy was issued. */
  policyIssued: "policy_issued",
} as const;

export type RealtimeTopic = (typeof REALTIME_TOPICS)[keyof typeof REALTIME_TOPICS];

/**
 * Per-topic ring-buffer capacity. These caps bound memory usage during long
 * sessions — see `RealtimeClient` which creates one `RingBuffer` per topic.
 */
export const TOPIC_BUFFER_CAPS: Record<RealtimeTopic, number> = {
  // Oracle updates fire frequently (multiple per minute).
  [REALTIME_TOPICS.oracleUpdate]: 100,
  // Claim settlements are rare — keep a full history.
  [REALTIME_TOPICS.claimSettled]: 50,
  // Pool stats update with every deposit/withdraw.
  [REALTIME_TOPICS.poolStatsUpdate]: 50,
  // Policy issued events are low-frequency.
  [REALTIME_TOPICS.policyIssued]: 50,
} as const;

/**
 * Maps a realtime topic to the TanStack Query keys that should be
 * invalidated when a push event arrives on that topic. The invalidation
 * provider (see `RealtimeSyncProvider`) uses this to refresh cached REST
 * payloads so rendered data reflects the push.
 *
 * Keys are prefixes — invalidating `["oracle"]` refreshes every query
 * whose key starts with `["oracle", …]`.
 */
export const TOPIC_TO_QUERY_KEYS: Record<RealtimeTopic, readonly (readonly string[])[]> = {
  [REALTIME_TOPICS.oracleUpdate]: [["oracle"]] as const,
  [REALTIME_TOPICS.claimSettled]: [
    ["claims"],
    ["claimStats"],
  ] as const,
  [REALTIME_TOPICS.poolStatsUpdate]: [
    ["poolStats"],
    ["poolAllocation"],
  ] as const,
  [REALTIME_TOPICS.policyIssued]: [
    ["policies"],
    ["holderPolicies"],
  ] as const,
} as const;

/**
 * Human-readable description for each topic, used by the ARIA live region
 * system to announce meaningful changes to screen-reader users. The
 * announcement text is composed at call-time from the payload, but these
 * labels provide the consistent "what kind of update" prefix.
 */
export const TOPIC_ANNOUNCEMENTS: Record<RealtimeTopic, string> = {
  [REALTIME_TOPICS.oracleUpdate]: "Oracle reading updated",
  [REALTIME_TOPICS.claimSettled]: "Claim settled",
  [REALTIME_TOPICS.poolStatsUpdate]: "Pool statistics updated",
  [REALTIME_TOPICS.policyIssued]: "Policy issued",
} as const;

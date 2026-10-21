/**
 * Realtime topic names. The full contract (payload shapes, who publishes
 * what) is documented in docs/realtime.md.
 */

/** Client/transport control topics. Never delivered to `subscribe` handlers. */
export const INTERNAL_TOPICS = {
  /** Client → server: `{ t0 }` clock-sync / keepalive ping. */
  PING: "refract.ping",
  /** Server → client: `{ t0, serverTs }` reply to a ping. */
  PONG: "refract.pong",
  /** Server → client: `{ compressedBytes, uncompressedBytes }` cumulative wire stats for this connection. */
  WIRE_STATS: "refract.wire_stats",
} as const;

const INTERNAL_TOPIC_SET: ReadonlySet<string> = new Set(Object.values(INTERNAL_TOPICS));

export function isInternalTopic(topic: string): boolean {
  return INTERNAL_TOPIC_SET.has(topic);
}

/**
 * Policy lifecycle events (accepted / issued / premium_charged / cancelled /
 * failed) for every policy held by `address`. Payloads: `policyEventSchema`
 * in ./policyEvents.
 */
export function policyTopic(address: string): string {
  return `policy.${address}`;
}

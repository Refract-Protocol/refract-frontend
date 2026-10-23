/**
 * Per-connection subscription limits and graceful degradation policy.
 *
 * Defaults are documented here and can be tuned via `public/flags.json`
 * (see `realtime-limits`). Limits are enforced at the registry boundary so
 * no consumer can bypass them.
 */

export type TopicPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Priority ordering per topic. Lower rank = more important = degrades last.
 * Notifications and transaction status outrank high-frequency oracle frames.
 */
export const TOPIC_PRIORITY: Record<string, TopicPriority> = {
  notifications: 'critical',
  'transaction-status': 'critical',
  'claim-settlement': 'high',
  'pool-stats': 'normal',
  oracle: 'low',
};

const PRIORITY_RANK: Record<TopicPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export interface RealtimeLimits {
  /** Maximum concurrent topic subscriptions per connection. Default: 8. */
  maxTopicsPerConnection: number;
  /** Maximum inbound messages per second per connection. Default: 50. */
  maxInboundMessagesPerSecond: number;
}

export const DEFAULT_LIMITS: RealtimeLimits = {
  maxTopicsPerConnection: 8,
  maxInboundMessagesPerSecond: 50,
};

/**
 * Resolve limits from a flags object (e.g. parsed `public/flags.json`),
 * falling back to documented defaults for any missing/invalid value.
 */
export function resolveLimits(flags?: unknown): RealtimeLimits {
  const raw =
    flags && typeof flags === 'object'
      ? (flags as Record<string, unknown>)['realtime-limits']
      : undefined;
  const cfg = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const maxTopics = Number(cfg['max-topics-per-connection']);
  const maxRate = Number(cfg['max-inbound-messages-per-second']);

  return {
    maxTopicsPerConnection:
      Number.isFinite(maxTopics) && maxTopics > 0
        ? Math.floor(maxTopics)
        : DEFAULT_LIMITS.maxTopicsPerConnection,
    maxInboundMessagesPerSecond:
      Number.isFinite(maxRate) && maxRate > 0
        ? Math.floor(maxRate)
        : DEFAULT_LIMITS.maxInboundMessagesPerSecond,
  };
}

/** Rank a topic by its declared priority (unknown topics default to `normal`). */
export function topicRank(topic: string): number {
  const priority = TOPIC_PRIORITY[topic] ?? 'normal';
  return PRIORITY_RANK[priority];
}

/**
 * Deterministic degradation decision: given the currently subscribed topics
 * and a candidate, decide whether the candidate may be admitted.
 *
 * - Duplicate (refcounted) subscriptions never count against the limit.
 * - When full, a candidate is admitted only if it outranks the lowest-priority
 *   currently-held topic, which is then evicted (reversible when load drops).
 */
export function canAdmitTopic(
  currentTopics: string[],
  candidate: string,
  limits: RealtimeLimits,
): { admit: boolean; evict?: string; reason?: string } {
  if (currentTopics.includes(candidate)) {
    return { admit: true };
  }

  if (currentTopics.length < limits.maxTopicsPerConnection) {
    return { admit: true };
  }

  const candidateRank = topicRank(candidate);
  let lowestTopic: string | undefined;
  let lowestRank = -1;
  for (const topic of currentTopics) {
    const rank = topicRank(topic);
    if (rank > lowestRank) {
      lowestRank = rank;
      lowestTopic = topic;
    }
  }

  if (lowestTopic !== undefined && candidateRank < lowestRank) {
    return { admit: true, evict: lowestTopic };
  }

  return {
    admit: false,
    reason: `topic limit reached (${currentTopics.length}/${limits.maxTopicsPerConnection}); "${candidate}" is not higher priority than held topics`,
  };
}

/**
 * Sliding one-second window counter for inbound message rate breaches.
 * Breaches are counted so they can be reported to observability.
 */
export class InboundRateLimiter {
  private windowStart = 0;
  private count = 0;
  private breaches = 0;

  constructor(private readonly maxPerSecond: number) {}

  /** Record an inbound message; returns true if within the rate limit. */
  record(now: number = Date.now()): boolean {
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.count = 0;
    }
    this.count += 1;
    if (this.count > this.maxPerSecond) {
      this.breaches += 1;
      return false;
    }
    return true;
  }

  get breachCount(): number {
    return this.breaches;
  }
}

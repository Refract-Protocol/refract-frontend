export const DEFAULT_MAX_TOPICS_PER_CONNECTION = 8;
export const DEFAULT_MAX_MESSAGES_PER_SECOND = 60;
export const DEFAULT_RATE_WINDOW_MS = 1_000;

/**
 * Higher number = higher priority (degrades last).
 * Critical user-facing events (`notifications`, `claims.settlement`) outrank
 * aggregate metrics (`pool.stats`) and high-frequency feeds (`oracle.readings`).
 */
export const DEFAULT_TOPIC_PRIORITIES: Readonly<Record<string, number>> = {
  notifications: 100,
  "claims.settlement": 90,
  "tx.status": 85,
  "pool.stats": 50,
  "oracle.readings": 30,
};

export function getTopicPriority(
  topic: string,
  customPriorities: Readonly<Record<string, number>> = DEFAULT_TOPIC_PRIORITIES,
): number {
  return customPriorities[topic] ?? 40;
}

export type SubscriptionAdmissionResult =
  | {
      admitted: true;
      mode: "realtime";
      topic: string;
      refCount: number;
      evictedTopic?: string;
    }
  | {
      admitted: false;
      mode: "rest_fallback";
      topic: string;
      reason: "topic_limit_exceeded" | "rate_limit_degraded";
    };

export interface InboundRateDecision {
  allowed: boolean;
  mode: "realtime" | "rest_fallback";
  reason?: "rate_limit_exceeded" | "topic_degraded";
  currentRatePerWindow: number;
}

export interface LimitsDiagnosticsSnapshot {
  activeTopics: Array<{ topic: string; refCount: number; priority: number }>;
  degradedTopics: string[];
  maxTopicsPerConnection: number;
  maxMessagesPerSecond: number;
  rejectedSubscriptions: number;
  evictedSubscriptions: number;
  rateLimitBreaches: number;
}

export interface ConnectionLimitsEnforcerOptions {
  maxTopicsPerConnection?: number;
  maxMessagesPerSecond?: number;
  rateWindowMs?: number;
  topicPriorities?: Readonly<Record<string, number>>;
  onDegradeTopic?: (topic: string, reason: string) => void;
  now?: () => number;
}

/**
 * Enforces per-connection subscription ceilings and inbound message rate limits.
 * Refcounted duplicate registrations for an already-active topic do not consume
 * additional topic slots. When limits are breached, low-priority topics are
 * deterministically degraded to `rest_fallback` first and recover when capacity
 * or message rates normalize.
 */
export class ConnectionLimitsEnforcer {
  private readonly maxTopics: number;
  private readonly maxMessagesPerWindow: number;
  private readonly rateWindowMs: number;
  private readonly priorities: Readonly<Record<string, number>>;
  private readonly onDegradeTopic?: (topic: string, reason: string) => void;
  private readonly now: () => number;

  private readonly activeRefCounts = new Map<string, number>();
  private readonly degradedTopics = new Set<string>();
  private messageTimestamps: number[] = [];
  private rejectedSubscriptions = 0;
  private evictedSubscriptions = 0;
  private rateLimitBreaches = 0;

  constructor(options: ConnectionLimitsEnforcerOptions = {}) {
    this.maxTopics = Math.max(1, options.maxTopicsPerConnection ?? DEFAULT_MAX_TOPICS_PER_CONNECTION);
    this.maxMessagesPerWindow = Math.max(
      1,
      options.maxMessagesPerSecond ?? DEFAULT_MAX_MESSAGES_PER_SECOND,
    );
    this.rateWindowMs = Math.max(100, options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS);
    this.priorities = options.topicPriorities ?? DEFAULT_TOPIC_PRIORITIES;
    this.onDegradeTopic = options.onDegradeTopic;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Attempts to acquire a subscription slot for `topic`.
   * If `topic` is already active, increments its reference count without consuming
   * another connection slot.
   */
  acquireSubscription(topic: string): SubscriptionAdmissionResult {
    const existingRefs = this.activeRefCounts.get(topic) ?? 0;
    if (existingRefs > 0) {
      const nextRefs = existingRefs + 1;
      this.activeRefCounts.set(topic, nextRefs);
      return { admitted: true, mode: "realtime", topic, refCount: nextRefs };
    }

    if (this.activeRefCounts.size < this.maxTopics) {
      this.activeRefCounts.set(topic, 1);
      this.degradedTopics.delete(topic);
      return { admitted: true, mode: "realtime", topic, refCount: 1 };
    }

    // Connection is at capacity: check if the incoming topic outranks the lowest-priority active topic
    const incomingPriority = getTopicPriority(topic, this.priorities);
    const lowestCandidate = this.findLowestPriorityActiveTopic();

    if (lowestCandidate && incomingPriority > lowestCandidate.priority) {
      this.activeRefCounts.delete(lowestCandidate.topic);
      this.degradedTopics.add(lowestCandidate.topic);
      this.evictedSubscriptions += 1;
      this.onDegradeTopic?.(
        lowestCandidate.topic,
        `Evicted by higher-priority topic "${topic}" (${incomingPriority} > ${lowestCandidate.priority})`,
      );

      this.activeRefCounts.set(topic, 1);
      this.degradedTopics.delete(topic);
      return {
        admitted: true,
        mode: "realtime",
        topic,
        refCount: 1,
        evictedTopic: lowestCandidate.topic,
      };
    }

    this.rejectedSubscriptions += 1;
    this.degradedTopics.add(topic);
    this.onDegradeTopic?.(
      topic,
      `Refused subscription: maxTopicsPerConnection (${this.maxTopics}) reached`,
    );
    return {
      admitted: false,
      mode: "rest_fallback",
      topic,
      reason: "topic_limit_exceeded",
    };
  }

  /**
   * Releases one reference to `topic`. When the last consumer releases `topic`,
   * the slot frees up immediately so previously degraded topics can be re-admitted.
   */
  releaseSubscription(topic: string): void {
    const current = this.activeRefCounts.get(topic);
    if (!current) return;
    if (current <= 1) {
      this.activeRefCounts.delete(topic);
    } else {
      this.activeRefCounts.set(topic, current - 1);
    }
  }

  /**
   * Evaluates an inbound message against the sliding-window rate limit.
   * When the connection exceeds `maxMessagesPerSecond`, the lowest-priority active
   * topic (or the offending low-priority topic) is degraded to `rest_fallback`.
   */
  recordInboundMessage(topic: string): InboundRateDecision {
    const currentTime = this.now();
    const cutoff = currentTime - this.rateWindowMs;
    this.messageTimestamps = this.messageTimestamps.filter((ts) => ts > cutoff);

    if (this.degradedTopics.has(topic)) {
      return {
        allowed: false,
        mode: "rest_fallback",
        reason: "topic_degraded",
        currentRatePerWindow: this.messageTimestamps.length,
      };
    }

    if (this.messageTimestamps.length >= this.maxMessagesPerWindow) {
      this.rateLimitBreaches += 1;
      const victim = this.findLowestPriorityActiveTopic()?.topic ?? topic;
      this.activeRefCounts.delete(victim);
      this.degradedTopics.add(victim);
      this.onDegradeTopic?.(
        victim,
        `Inbound message rate exceeded (${this.maxMessagesPerWindow}/${this.rateWindowMs}ms)`,
      );

      return {
        allowed: false,
        mode: "rest_fallback",
        reason: "rate_limit_exceeded",
        currentRatePerWindow: this.messageTimestamps.length,
      };
    }

    this.messageTimestamps.push(currentTime);
    return {
      allowed: true,
      mode: "realtime",
      currentRatePerWindow: this.messageTimestamps.length,
    };
  }

  private findLowestPriorityActiveTopic(): { topic: string; priority: number } | null {
    let lowest: { topic: string; priority: number } | null = null;
    for (const topic of this.activeRefCounts.keys()) {
      const priority = getTopicPriority(topic, this.priorities);
      if (
        !lowest ||
        priority < lowest.priority ||
        (priority === lowest.priority && topic.localeCompare(lowest.topic) > 0)
      ) {
        lowest = { topic, priority };
      }
    }
    return lowest;
  }

  getDiagnostics(): LimitsDiagnosticsSnapshot {
    const activeTopics = Array.from(this.activeRefCounts.entries())
      .map(([topic, refCount]) => ({
        topic,
        refCount,
        priority: getTopicPriority(topic, this.priorities),
      }))
      .sort((a, b) => b.priority - a.priority || a.topic.localeCompare(b.topic));

    return {
      activeTopics,
      degradedTopics: Array.from(this.degradedTopics).sort(),
      maxTopicsPerConnection: this.maxTopics,
      maxMessagesPerSecond: this.maxMessagesPerWindow,
      rejectedSubscriptions: this.rejectedSubscriptions,
      evictedSubscriptions: this.evictedSubscriptions,
      rateLimitBreaches: this.rateLimitBreaches,
    };
  }
}

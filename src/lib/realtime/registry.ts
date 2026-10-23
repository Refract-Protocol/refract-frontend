import {
  DEFAULT_REALTIME_LIMITS,
  InboundRateLimiter,
  RealtimeLimits,
  decideAdmission,
} from './limits';

export interface RealtimeRegistryOptions {
  limits?: RealtimeLimits;
  /** Observability sink for rate-limit breaches and rejections. */
  report?: (event: RealtimeObservabilityEvent) => void;
}

export interface RealtimeObservabilityEvent {
  type: 'subscription-rejected' | 'rate-limit-breach';
  topic?: string;
  reason?: string;
  breaches?: number;
}

type Listener = (payload: unknown) => void;

interface SubscriptionEntry {
  listeners: Set<Listener>;
}

/**
 * Central registry for realtime topic subscriptions. Limits are enforced here
 * so no consumer can bypass them. Duplicate (refcounted) subscriptions do not
 * count against the topic limit.
 */
export class RealtimeRegistry {
  private readonly limits: RealtimeLimits;
  private readonly report?: (event: RealtimeObservabilityEvent) => void;
  private readonly subscriptions = new Map<string, SubscriptionEntry>();
  private readonly rateLimiter: InboundRateLimiter;

  constructor(options: RealtimeRegistryOptions = {}) {
    this.limits = options.limits ?? DEFAULT_REALTIME_LIMITS;
    this.report = options.report;
    this.rateLimiter = new InboundRateLimiter(this.limits);
  }

  /**
   * Subscribe a listener to a topic. Returns an unsubscribe function, or null
   * when the subscription was refused due to limits (caller should stay on
   * REST polling).
   */
  subscribe(topic: string, listener: Listener): (() => void) | null {
    const existing = this.subscriptions.get(topic);
    if (existing) {
      existing.listeners.add(listener);
      return () => this.unsubscribe(topic, listener);
    }

    const decision = decideAdmission([...this.subscriptions.keys()], topic, this.limits);
    if (!decision.admitted) {
      this.report?.({ type: 'subscription-rejected', topic, reason: decision.reason });
      // eslint-disable-next-line no-console
      console.warn(`[realtime] subscription refused for "${topic}": ${decision.reason}`);
      return null;
    }

    if (decision.evict) {
      this.subscriptions.delete(decision.evict);
    }

    this.subscriptions.set(topic, { listeners: new Set([listener]) });
    return () => this.unsubscribe(topic, listener);
  }

  private unsubscribe(topic: string, listener: Listener): void {
    const entry = this.subscriptions.get(topic);
    if (!entry) return;
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      this.subscriptions.delete(topic);
    }
  }

  /** Dispatch an inbound frame to topic listeners, enforcing the rate limit. */
  dispatch(topic: string, payload: unknown): void {
    if (this.rateLimiter.record()) {
      this.report?.({ type: 'rate-limit-breach', topic, breaches: this.rateLimiter.getBreachCount() });
      return;
    }
    const entry = this.subscriptions.get(topic);
    if (!entry) return;
    for (const listener of entry.listeners) {
      listener(payload);
    }
  }

  getActiveTopics(): string[] {
    return [...this.subscriptions.keys()];
  }

  getRateBreachCount(): number {
    return this.rateLimiter.getBreachCount();
  }
}

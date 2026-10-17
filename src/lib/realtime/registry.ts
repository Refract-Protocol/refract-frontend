export type TopicSubscriber = (payload: unknown) => void;

export interface UnderlyingTopicTransport {
  subscribe(topic: string, handler: TopicSubscriber): () => void;
  disconnect(): void;
}

const noopTransport: UnderlyingTopicTransport = {
  subscribe: () => () => {},
  disconnect: () => {},
};

export interface TopicSubscriptionSummary {
  topic: string;
  refCount: number;
  pendingTeardown: boolean;
}

export interface SubscriptionRegistrySnapshot {
  activeTopics: TopicSubscriptionSummary[];
  totalSubscribers: number;
}

export type RegistryChangeListener = (snapshot: SubscriptionRegistrySnapshot) => void;

export interface SubscriptionRegistryOptions {
  transport?: UnderlyingTopicTransport;
  /**
   * Grace window (in ms) before tearing down an unreferenced topic subscription.
   * Coalesces React 18 StrictMode unmount/remount cycles and rapid route transitions
   * within the same tick without thrashing the underlying socket.
   */
  teardownGraceMs?: number;
}

interface TopicEntry {
  subscribers: Set<TopicSubscriber>;
  upstreamUnsubscribe: (() => void) | null;
  teardownTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Centralized per-topic subscription registry owning `topic -> refCount -> upstream transport`
 * lifecycle. Opens a single upstream subscription when the first consumer subscribes to a topic
 * and lazily tears down the upstream subscription (and disconnects the transport when all topics
 * are idle) only after the last consumer unsubscribes.
 */
export class TopicSubscriptionRegistry {
  private readonly entries = new Map<string, TopicEntry>();
  private readonly changeListeners = new Set<RegistryChangeListener>();
  private readonly transport: UnderlyingTopicTransport;
  private readonly teardownGraceMs: number;

  constructor(options: SubscriptionRegistryOptions = {}) {
    this.transport = options.transport ?? noopTransport;
    this.teardownGraceMs = options.teardownGraceMs ?? 15;
  }

  /**
   * Registers a subscriber for `topic` and returns an idempotent `unsubscribe` callback.
   */
  subscribe(topic: string, handler: TopicSubscriber): () => void {
    let entry = this.entries.get(topic);
    if (!entry) {
      entry = {
        subscribers: new Set(),
        upstreamUnsubscribe: null,
        teardownTimer: null,
      };
      this.entries.set(topic, entry);
    }

    if (entry.teardownTimer !== null) {
      clearTimeout(entry.teardownTimer);
      entry.teardownTimer = null;
    }

    entry.subscribers.add(handler);

    if (!entry.upstreamUnsubscribe) {
      entry.upstreamUnsubscribe = this.openUpstreamSubscription(topic, entry);
    }

    this.emitChange();

    let active = true;
    return () => {
      if (!active) return;
      active = false;

      const currentEntry = this.entries.get(topic);
      if (!currentEntry) return;

      currentEntry.subscribers.delete(handler);
      if (currentEntry.subscribers.size === 0) {
        this.scheduleTopicTeardown(topic, currentEntry);
      } else {
        this.emitChange();
      }
    };
  }

  private openUpstreamSubscription(topic: string, entry: TopicEntry): () => void {
    return this.transport.subscribe(topic, (payload) => {
      // Snapshot listeners in case a callback subscribes/unsubscribes during dispatch
      const listeners = Array.from(entry.subscribers);
      for (const listener of listeners) {
        listener(payload);
      }
    });
  }

  private scheduleTopicTeardown(topic: string, entry: TopicEntry): void {
    if (this.teardownGraceMs <= 0) {
      this.finalizeTopicTeardown(topic, entry);
      return;
    }

    if (entry.teardownTimer !== null) {
      clearTimeout(entry.teardownTimer);
    }

    this.emitChange();
    entry.teardownTimer = setTimeout(() => {
      entry.teardownTimer = null;
      if (entry.subscribers.size === 0) {
        this.finalizeTopicTeardown(topic, entry);
      }
    }, this.teardownGraceMs);
  }

  private finalizeTopicTeardown(topic: string, entry: TopicEntry): void {
    entry.upstreamUnsubscribe?.();
    entry.upstreamUnsubscribe = null;
    this.entries.delete(topic);

    if (this.entries.size === 0) {
      this.transport.disconnect();
    }

    this.emitChange();
  }

  /**
   * Re-establishes upstream transport subscriptions for all currently active topics
   * after a connection drop or transport switch.
   */
  resubscribeAll(): void {
    for (const [topic, entry] of this.entries.entries()) {
      if (entry.subscribers.size > 0) {
        entry.upstreamUnsubscribe?.();
        entry.upstreamUnsubscribe = this.openUpstreamSubscription(topic, entry);
      }
    }
    this.emitChange();
  }

  /**
   * Returns an inspectable snapshot of active topics and reference counts for
   * the dev inspector panel and health diagnostics.
   */
  getSnapshot(): SubscriptionRegistrySnapshot {
    const activeTopics: TopicSubscriptionSummary[] = [];
    let totalSubscribers = 0;

    for (const [topic, entry] of this.entries.entries()) {
      const refCount = entry.subscribers.size;
      totalSubscribers += refCount;
      activeTopics.push({
        topic,
        refCount,
        pendingTeardown: entry.teardownTimer !== null,
      });
    }

    activeTopics.sort((a, b) => a.topic.localeCompare(b.topic));
    return { activeTopics, totalSubscribers };
  }

  getRefCount(topic: string): number {
    return this.entries.get(topic)?.subscribers.size ?? 0;
  }

  onRegistryChange(listener: RegistryChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  /**
   * Immediately tears down all topics and disconnects the underlying transport.
   */
  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.teardownTimer !== null) {
        clearTimeout(entry.teardownTimer);
      }
      entry.upstreamUnsubscribe?.();
    }
    this.entries.clear();
    this.transport.disconnect();
    this.emitChange();
  }

  private emitChange(): void {
    if (this.changeListeners.size === 0) return;
    const snapshot = this.getSnapshot();
    this.changeListeners.forEach((listener) => listener(snapshot));
  }
}

export const topicSubscriptionRegistry = new TopicSubscriptionRegistry();

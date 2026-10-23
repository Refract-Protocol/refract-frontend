import { SNAPSHOT_TOPICS, type RealtimeTopic, type RealtimeTopics } from "./topics";

type BusHandler<T extends RealtimeTopic> = (payload: RealtimeTopics[T]) => void;

const MAX_HANDLERS_PER_TOPIC = 100;

/**
 * Typed pub/sub between the realtime client (which decodes and validates) and
 * in-app consumers. Per-topic arrival order is preserved, one throwing handler
 * never blocks the others, and snapshot topics replay their latest value to
 * late subscribers.
 */
export class RealtimeBus {
  private handlers = new Map<RealtimeTopic, Set<BusHandler<never>>>();
  private latest = new Map<RealtimeTopic, unknown>();
  private queues = new Map<RealtimeTopic, unknown[]>();
  private draining = new Set<RealtimeTopic>();

  publish<T extends RealtimeTopic>(topic: T, payload: RealtimeTopics[T]): void {
    if (SNAPSHOT_TOPICS.has(topic)) this.latest.set(topic, payload);
    const queue = this.queues.get(topic) ?? [];
    queue.push(payload);
    this.queues.set(topic, queue);
    // Re-entrant publishes are queued and delivered after the current event.
    if (this.draining.has(topic)) return;
    this.draining.add(topic);
    try {
      while (queue.length) {
        const next = queue.shift() as RealtimeTopics[T];
        for (const handler of [...(this.handlers.get(topic) ?? [])]) {
          try {
            (handler as BusHandler<T>)(next);
          } catch {
            console.error(`[realtime] handler for "${topic}" threw`);
          }
        }
      }
    } finally {
      this.draining.delete(topic);
    }
  }

  subscribe<T extends RealtimeTopic>(topic: T, handler: BusHandler<T>): () => void {
    let set = this.handlers.get(topic);
    if (!set) this.handlers.set(topic, (set = new Set()));
    if (set.size >= MAX_HANDLERS_PER_TOPIC && !set.has(handler as BusHandler<never>)) {
      console.error(`[realtime] handler limit reached for "${topic}"`);
      return () => {};
    }
    // Set semantics make a StrictMode double-registration of the same handler a no-op.
    set.add(handler as BusHandler<never>);
    return () => {
      this.handlers.get(topic)?.delete(handler as BusHandler<never>);
    };
  }

  /** Latest value of a snapshot topic, or undefined if none has arrived. */
  getSnapshot<T extends RealtimeTopic>(topic: T): RealtimeTopics[T] | undefined {
    return this.latest.get(topic) as RealtimeTopics[T] | undefined;
  }

  handlerCount(topic: RealtimeTopic): number {
    return this.handlers.get(topic)?.size ?? 0;
  }

  reset(): void {
    this.handlers.clear();
    this.latest.clear();
    this.queues.clear();
    this.draining.clear();
  }
}

export const realtimeBus = new RealtimeBus();

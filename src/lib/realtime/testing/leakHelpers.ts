/**
 * Test-only utilities for the realtime leak-detection suite.
 *
 * Nothing here is imported outside tests, so it never reaches the production
 * bundle. Import from `@/lib/realtime/testing/leakHelpers` in `*.test.ts` files
 * only.
 */
import type { RegistryTransport } from "../registry";

/** Flush the microtask queue so coalesced teardowns in `SubscriptionRegistry` run. */
export async function flushMicrotasks(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

/**
 * In-memory transport for `SubscriptionRegistry` tests. Records every
 * subscribe / unsubscribe so tests can assert the balance reaches zero.
 */
export class FakeRegistryTransport implements RegistryTransport {
  readonly subscribeCalls: string[] = [];
  readonly unsubscribeCalls: string[] = [];
  private readonly handlers = new Map<string, (event: unknown) => void>();

  subscribe(topic: string, onEvent: (event: unknown) => void): () => void {
    this.subscribeCalls.push(topic);
    this.handlers.set(topic, onEvent);
    return () => {
      this.unsubscribeCalls.push(topic);
      this.handlers.delete(topic);
    };
  }

  /** Deliver an event to the handler registered for `topic` (no-op if none). */
  emit(topic: string, event: unknown): void {
    this.handlers.get(topic)?.(event);
  }

  /** Number of topics with an active transport subscription. */
  get activeCount(): number {
    return this.handlers.size;
  }

  isSubscribed(topic: string): boolean {
    return this.handlers.has(topic);
  }

  /** Subscribe calls minus unsubscribe calls for a topic — should be 0 after teardown. */
  balanceFor(topic: string): number {
    const subs = this.subscribeCalls.filter((t) => t === topic).length;
    const unsubs = this.unsubscribeCalls.filter((t) => t === topic).length;
    return subs - unsubs;
  }
}

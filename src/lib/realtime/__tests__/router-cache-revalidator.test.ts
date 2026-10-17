import { describe, expect, it } from 'vitest';
import {
  RevalidationFlushResult,
  RouterCacheRevalidator,
} from '../router-cache-revalidator';

describe('RouterCacheRevalidator', () => {
  it('coalesces event bursts within the rate-limit window into a single refresh', () => {
    let now = 10_000;
    const flushes: RevalidationFlushResult[] = [];
    const revalidator = new RouterCacheRevalidator(undefined, {
      coalesceWindowMs: 3_000,
      nowFn: () => now,
      onRevalidate: (res) => flushes.push(res),
    });

    // First event triggers immediate flush
    const first = revalidator.ingestEvent({
      eventId: 'evt-1',
      topic: 'policies.created',
      occurredAtMs: now,
    });
    expect(first.reason).toBe('flushed');
    expect(flushes).toHaveLength(1);

    // Subsequent events within 3000ms coalesce without triggering duplicate refreshes
    now = 11_000;
    const second = revalidator.ingestEvent({
      eventId: 'evt-2',
      topic: 'claims.updated',
      occurredAtMs: now,
    });
    expect(second.reason).toBe('coalesced_pending');
    expect(flushes).toHaveLength(1);

    now = 12_000;
    revalidator.ingestEvent({
      eventId: 'evt-3',
      topic: 'liquidity.deposited',
      occurredAtMs: now,
    });
    expect(flushes).toHaveLength(1);

    // Flushing after window expires emits single combined revalidation
    now = 13_500;
    const flushed = revalidator.flush();
    expect(flushed).not.toBeNull();
    expect(flushed!.coalescedEventCount).toBe(2);
    expect(flushed!.refreshedPaths).toEqual(['/claims', '/dashboard', '/liquidity', '/policies']);
  });

  it('prevents infinite revalidation loops by ignoring duplicate event IDs', () => {
    const revalidator = new RouterCacheRevalidator();
    const first = revalidator.ingestEvent({
      eventId: 'evt-dup',
      topic: 'policies.updated',
      occurredAtMs: 1000,
    });
    expect(first.accepted).toBe(true);

    const duplicate = revalidator.ingestEvent({
      eventId: 'evt-dup',
      topic: 'policies.updated',
      occurredAtMs: 5000,
    });
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.reason).toBe('duplicate_event');
  });

  it('defers revalidation during in-flight navigation or /cover confirmation step', () => {
    let now = 20_000;
    const revalidator = new RouterCacheRevalidator(undefined, {
      coalesceWindowMs: 1_000,
      nowFn: () => now,
    });

    revalidator.setActiveCriticalFlow('cover-confirmation');
    const res = revalidator.ingestEvent({
      eventId: 'evt-99',
      topic: 'protocol.parameters.updated',
      occurredAtMs: now,
    });

    expect(res.reason).toBe('coalesced_pending');
    expect(revalidator.hasPendingRevalidation()).toBe(true);

    // Releasing the critical flow immediately flushes pending revalidation
    const flushed = revalidator.setActiveCriticalFlow(null);
    expect(flushed).not.toBeNull();
    expect(flushed!.revalidatedTags).toEqual(['protocol-parameters']);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  RealtimeQueryRequestFrame,
  RealtimeRequestCorrelator,
} from '../request-response-correlator';

describe('RealtimeRequestCorrelator', () => {
  it('correlates concurrent in-flight requests by monotonic correlationId and consumes response frames', async () => {
    const sentFrames: RealtimeQueryRequestFrame[] = [];
    const correlator = new RealtimeRequestCorrelator({
      sendFrame: (f) => sentFrames.push(f),
    });

    const p1 = correlator.request<{ tvl: number }>('liquidity.snapshot', { pool: 'main' });
    const p2 = correlator.request<{ count: number }>('notifications.unread', {});

    expect(sentFrames.map((f) => f.correlationId)).toEqual(['req-1', 'req-2']);
    expect(correlator.getPendingCount()).toBe(2);

    // Out-of-order responses resolve the right promises and return true (consumed)
    expect(
      correlator.handleIncomingFrame({
        type: 'query_response',
        correlationId: 'req-2',
        ok: true,
        data: { count: 7 },
      })
    ).toBe(true);

    expect(
      correlator.handleIncomingFrame({
        type: 'query_response',
        correlationId: 'req-1',
        ok: true,
        data: { tvl: 500_000 },
      })
    ).toBe(true);

    // Regular topic broadcast frames return false so topic listeners receive them
    expect(
      correlator.handleIncomingFrame({
        type: 'event',
        topic: 'policies.updated',
      })
    ).toBe(false);

    await expect(p1).resolves.toEqual({ tvl: 500_000 });
    await expect(p2).resolves.toEqual({ count: 7 });
    expect(correlator.getPendingCount()).toBe(0);
  });

  it('rejects with REALTIME_REQUEST_TIMEOUT and REALTIME_REQUEST_ABORTED on timeout or abort', async () => {
    vi.useFakeTimers();
    try {
      const correlator = new RealtimeRequestCorrelator({
        sendFrame: () => {},
        defaultTimeoutMs: 1_000,
      });

      const timedOutPromise = correlator.request('pool.params', {});
      vi.advanceTimersByTime(1_050);
      await expect(timedOutPromise).rejects.toMatchObject({
        code: 'REALTIME_REQUEST_TIMEOUT',
      });

      const abortController = new AbortController();
      const abortedPromise = correlator.request(
        'pool.params',
        {},
        { signal: abortController.signal }
      );
      abortController.abort();
      await expect(abortedPromise).rejects.toMatchObject({
        code: 'REALTIME_REQUEST_ABORTED',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears and rejects all pending requests on disconnect', async () => {
    const correlator = new RealtimeRequestCorrelator({
      sendFrame: () => {},
    });

    const p1 = correlator.request('claims.snapshot', {});
    const p2 = correlator.request('policies.snapshot', {});
    expect(correlator.getPendingCount()).toBe(2);

    correlator.handleDisconnect('Socket closed');
    expect(correlator.getPendingCount()).toBe(0);

    await expect(p1).rejects.toMatchObject({
      code: 'REALTIME_TRANSPORT_DISCONNECTED',
    });
    await expect(p2).rejects.toMatchObject({
      code: 'REALTIME_TRANSPORT_DISCONNECTED',
    });
  });
});

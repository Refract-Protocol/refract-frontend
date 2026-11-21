import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLongPollTransport } from './longPoll';
import type { RealtimeError } from './types';

describe('longPoll transport', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('emits a typed rate_limited error and backs off by Retry-After on 429', async () => {
    const errors: RealtimeError[] = [];
    const delays: number[] = [];

    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 429,
      ok: false,
      headers: new Headers({ 'Retry-After': '5' }),
      json: async () => ({}),
    } as unknown as Response);

    const transport = createLongPollTransport({
      url: 'https://example.test/poll',
      onError: (err) => errors.push(err),
      onDelay: (ms) => delays.push(ms),
    });

    await transport.pollOnce();

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('rate_limited');
    expect(delays[0]).toBeGreaterThanOrEqual(5000);
  });
});

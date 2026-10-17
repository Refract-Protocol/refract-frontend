import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { LongPollTransport, type LongPollEventEnvelope } from './longPoll'

describe('LongPollTransport (#245)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers subscribed topics and cursor in GET query parameters and emits ordered events', async () => {
    const received: LongPollEventEnvelope[] = []
    const requestedUrls: string[] = []

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requestedUrls.push(url)

      if (requestedUrls.length === 1) {
        return new Response(
          JSON.stringify({
            cursor: 'cur-101',
            events: [
              {
                topic: 'oracle:XLM/USD',
                eventId: 'evt-1',
                cursor: 'cur-100',
                timestamp: 1_700_000_000_000,
                payload: { price: 0.125 },
              },
              {
                topic: 'claims:GABC',
                eventId: 'evt-2',
                cursor: 'cur-101',
                timestamp: 1_700_000_000_500,
                payload: { status: 'approved' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ cursor: 'cur-101', events: [] }),
        { status: 200 }
      )
    }) as unknown as typeof fetch

    const transport = new LongPollTransport({
      endpoint: 'https://api.refract.example/realtime/poll',
      fetchFn: mockFetch,
      initialCursor: 'cur-099',
      getHeaders: () => ({ Authorization: 'Bearer tok-xyz' }),
      onMessage: (evt) => received.push(evt),
    })

    transport.subscribe('oracle:XLM/USD')
    transport.subscribe('claims:GABC')

    await transport.pollOnce()

    expect(requestedUrls[0]).toBe(
      'https://api.refract.example/realtime/poll?topics=claims%3AGABC%2Coracle%3AXLM%2FUSD&cursor=cur-099'
    )
    expect(received).toHaveLength(2)
    expect(received[0].eventId).toBe('evt-1')
    expect(received[1].eventId).toBe('evt-2')
    expect(transport.getCursor()).toBe('cur-101')
    expect(transport.getState()).toBe('connected')

    transport.disconnect()
  })

  it('backs off exponentially on HTTP 429 and 5xx errors and recovers when 200 OK returns', async () => {
    const errors: Array<{ message: string; status?: number }> = []
    let callCount = 0

    const mockFetch = vi.fn(async () => {
      callCount += 1
      if (callCount === 1) {
        return new Response('Rate limited', {
          status: 429,
          headers: { 'Retry-After': '2' },
        })
      }
      if (callCount === 2) {
        return new Response('Gateway error', { status: 503 })
      }
      return new Response(
        JSON.stringify({
          cursor: 'cur-200',
          events: [
            {
              topic: 'pool:main',
              eventId: 'evt-ok',
              timestamp: 1_700_000_002_000,
              payload: { reserve: 50000 },
            },
          ],
        }),
        { status: 200 }
      )
    }) as unknown as typeof fetch

    const received: LongPollEventEnvelope[] = []
    const transport = new LongPollTransport({
      endpoint: '/api/realtime/poll',
      fetchFn: mockFetch,
      baseBackoffMs: 1_000,
      maxBackoffMs: 10_000,
      onError: (err, status) => errors.push({ message: err.message, status }),
      onMessage: (evt) => received.push(evt),
    })

    transport.subscribe('pool:main')
    transport.connect()

    // Trigger initial poll (fails with 429, Retry-After: 2s -> 2000ms backoff)
    await vi.advanceTimersByTimeAsync(0)
    expect(transport.getState()).toBe('backoff')
    expect(errors).toHaveLength(1)
    expect(errors[0].status).toBe(429)

    // Before 2000ms, second poll should not have fired yet
    await vi.advanceTimersByTimeAsync(1_500)
    expect(callCount).toBe(1)

    // At 2000ms, second poll fires and fails with 503 -> 2000ms backoff (1000 * 2^1)
    await vi.advanceTimersByTimeAsync(500)
    expect(callCount).toBe(2)
    expect(errors).toHaveLength(2)
    expect(errors[1].status).toBe(503)

    // Advance 2000ms for third poll -> succeeds with 200 OK
    await vi.advanceTimersByTimeAsync(2_000)
    expect(callCount).toBe(3)
    expect(transport.getState()).toBe('connected')
    expect(received).toHaveLength(1)
    expect(transport.getCursor()).toBe('cur-200')

    transport.disconnect()
  })

  it('caps concurrency at 1 in-flight request, tears down on visibility pause, and handles normal poll timeout cleanly', async () => {
    let fetchInvocations = 0
    const mockFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          fetchInvocations += 1
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
          })
        })
    ) as unknown as typeof fetch

    const errors: Error[] = []
    const transport = new LongPollTransport({
      endpoint: '/api/realtime/poll',
      fetchFn: mockFetch,
      requestTimeoutMs: 5_000,
      onError: (err) => errors.push(err),
    })

    transport.subscribe('oracle:XLM/USD')

    // Calling pollOnce concurrently should share the single in-flight promise
    const p1 = transport.pollOnce()
    const p2 = transport.pollOnce()
    expect(fetchInvocations).toBe(1)

    // Advance past the 5,000ms long-poll server timeout -> aborts cleanly without recording an error
    await vi.advanceTimersByTimeAsync(5_000)
    await Promise.all([p1, p2])
    expect(errors).toHaveLength(0)
    expect(transport.getState()).toBe('connected')

    // Pause visibility while a poll is in flight -> immediately aborts and stops scheduling
    transport.setVisibilityPaused(true)
    const countAfterPause = fetchInvocations
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchInvocations).toBe(countAfterPause)

    transport.disconnect()
    expect(transport.getState()).toBe('disconnected')
  })
})

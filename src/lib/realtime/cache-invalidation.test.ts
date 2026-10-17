import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  InMemorySharedCache,
  RealtimeCacheInvalidator,
  resolveTopicCacheMapping,
} from './cache-invalidation'

describe('RealtimeCacheInvalidator & topic->cache-key map (#254)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('maps realtime topics declaratively to shared REST cache keys and coalesces bursts within a tick window', async () => {
    const oracleMapping = resolveTopicCacheMapping('oracle:XLM/USD')
    expect(oracleMapping).toEqual({
      primaryKey: '/api/oracle/readings/XLM/USD',
      invalidatedKeys: [
        '/api/oracle/status',
        '/api/oracle/readings',
        '/api/oracle/readings/XLM/USD',
      ],
    })

    const cache = new InMemorySharedCache()
    const invalidator = new RealtimeCacheInvalidator({
      cache,
      realtimeEnabled: true,
      coalesceWindowMs: 50,
    })

    invalidator.registerSubscription('oracle:XLM/USD')

    // Burst of 10 high-frequency oracle events within 50ms
    for (let i = 0; i < 10; i++) {
      invalidator.handlePushEvent({
        topic: 'oracle:XLM/USD',
        payload: { price: 0.12 + i * 0.001 },
      })
    }

    // Before coalescing window expires, no invalidations have fired yet
    expect(cache.invalidationHistory).toHaveLength(0)

    // Advance 50ms -> each affected key is invalidated exactly once for the entire burst
    await vi.advanceTimersByTimeAsync(50)
    expect(cache.invalidationHistory).toEqual([
      '/api/oracle/status',
      '/api/oracle/readings',
      '/api/oracle/readings/XLM/USD',
    ])
  })

  it('updates target consumer state on push while leaving unrelated cache entries untouched', async () => {
    const cache = new InMemorySharedCache()
    cache.set('/api/claims/wallet/GABC', [{ id: 'c-1', status: 'pending' }])
    cache.set('/api/pool/stats', { tvl: '1000000' })

    let claimsHookRenderCount = 0
    let poolHookRenderCount = 0
    let renderedClaims = cache.get<Array<{ id: string; status: string }>>(
      '/api/claims/wallet/GABC'
    )

    cache.subscribe('/api/claims/wallet/GABC', () => {
      claimsHookRenderCount += 1
      renderedClaims = cache.get('/api/claims/wallet/GABC')
    })
    cache.subscribe('/api/pool/stats', () => {
      poolHookRenderCount += 1
    })

    const invalidator = new RealtimeCacheInvalidator({
      cache,
      realtimeEnabled: true,
      coalesceWindowMs: 20,
    })
    invalidator.registerSubscription('claims:GABC')

    // Push authoritative claim settlement event
    invalidator.handlePushEvent({
      topic: 'claims:GABC',
      authoritative: true,
      payload: [{ id: 'c-1', status: 'settled' }],
    })

    await vi.advanceTimersByTimeAsync(20)

    // Target hook received fresh authoritative data; unrelated pool cache key was never touched
    expect(claimsHookRenderCount).toBe(1)
    expect(renderedClaims).toEqual([{ id: 'c-1', status: 'settled' }])
    expect(poolHookRenderCount).toBe(0)
    expect(cache.get('/api/pool/stats')).toEqual({ tvl: '1000000' })
  })

  it('is a strict no-op when realtime is disabled or when topic is not subscribed', async () => {
    const cache = new InMemorySharedCache()
    const invalidator = new RealtimeCacheInvalidator({
      cache,
      realtimeEnabled: false,
      coalesceWindowMs: 10,
    })
    invalidator.registerSubscription('pool:main')

    // Disabled -> no-op
    expect(
      invalidator.handlePushEvent({ topic: 'pool:main', payload: { tvl: '200' } })
    ).toBe(false)

    // Enabled, but topic 'oracle:XLM/USD' is not subscribed -> no-op
    invalidator.setRealtimeEnabled(true)
    expect(
      invalidator.handlePushEvent({
        topic: 'oracle:XLM/USD',
        payload: { price: 0.15 },
      })
    ).toBe(false)

    await vi.advanceTimersByTimeAsync(50)
    expect(cache.invalidationHistory).toHaveLength(0)
  })
})

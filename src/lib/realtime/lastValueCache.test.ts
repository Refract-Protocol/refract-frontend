import { describe, expect, it } from 'vitest'
import { LastValueTopicCache } from './lastValueCache'

describe('LastValueTopicCache', () => {
  it('hydrates late-mounting subscribers synchronously and tracks soft staleness and hard TTL expiry', () => {
    let clock = 1_700_000_000_000
    const cache = new LastValueTopicCache({
      maxEntries: 50,
      ttlMs: 10_000,
      staleAfterMs: 4_000,
      now: () => clock,
    })

    const stored = cache.setLastValue(
      'claims:0xabc',
      { claimId: 'c-1', status: 'VOTING' },
      { sequence: 10, source: 'websocket' },
    )
    expect(stored).toBe(true)

    // Advance 1.5s — still fresh
    clock += 1_500
    const freshSnap = cache.getLastValue<{ claimId: string; status: string }>(
      'claims:0xabc',
    )
    expect(freshSnap).toEqual({
      topic: 'claims:0xabc',
      value: { claimId: 'c-1', status: 'VOTING' },
      receivedAt: 1_700_000_000_000,
      ageMs: 1_500,
      source: 'websocket',
      sequence: 10,
      version: undefined,
      isCached: true,
      isStale: false,
    })

    // Advance to 5s total age (>= staleAfterMs 4s, <= ttlMs 10s)
    clock += 3_500
    const staleSnap = cache.getLastValue('claims:0xabc')
    expect(staleSnap?.isStale).toBe(true)
    expect(staleSnap?.ageMs).toBe(5_000)

    // Advance past 10s hard TTL
    clock += 6_000
    expect(cache.getLastValue('claims:0xabc')).toBeNull()
    expect(cache.size()).toBe(0)
  })

  it('enforces monotonic sequence, version, and timestamp guards against out-of-order updates', () => {
    const cache = new LastValueTopicCache({ now: () => 5_000 })

    expect(
      cache.setLastValue(
        'pool:tvl',
        { tvl: 120_000 },
        { sequence: 5, version: 2, receivedAt: 5_000 },
      ),
    ).toBe(true)

    // Older sequence rejected even if timestamp is newer
    expect(
      cache.setLastValue(
        'pool:tvl',
        { tvl: 90_000 },
        { sequence: 4, version: 2, receivedAt: 6_000 },
      ),
    ).toBe(false)

    // Older timestamp rejected when sequence is not newer
    expect(
      cache.setLastValue(
        'pool:tvl',
        { tvl: 95_000 },
        { receivedAt: 4_500 },
      ),
    ).toBe(false)

    // Newer sequence accepted
    expect(
      cache.setLastValue(
        'pool:tvl',
        { tvl: 150_000 },
        { sequence: 6, version: 3, receivedAt: 5_500 },
      ),
    ).toBe(true)

    expect(cache.getLastValue('pool:tvl')?.value).toEqual({ tvl: 150_000 })
  })

  it('evicts the least-recently-used topic when maxEntries is exceeded', () => {
    const cache = new LastValueTopicCache({ maxEntries: 3, now: () => 1_000 })

    cache.setLastValue('topic:a', 1)
    cache.setLastValue('topic:b', 2)
    cache.setLastValue('topic:c', 3)

    // Touch topic:a so topic:b becomes the oldest LRU entry
    expect(cache.getLastValue('topic:a')?.value).toBe(1)

    // Adding topic:d should evict topic:b
    cache.setLastValue('topic:d', 4)

    expect(cache.keys()).toEqual(['topic:c', 'topic:a', 'topic:d'])
    expect(cache.getLastValue('topic:b')).toBeNull()
  })

  it('purges cached entries when wallet address or Stellar network scope changes', () => {
    const cache = new LastValueTopicCache({
      initialScope: { walletAddress: 'GUSER1', network: 'testnet' },
    })

    cache.setLastValue('claims:GUSER1', ['claim-1'])
    cache.setLastValue('pool:summary', { apy: 7.2 })

    // Same scope (case-insensitive) -> no clear
    expect(
      cache.clearOnScopeChange({ walletAddress: 'guser1', network: 'TESTNET' }),
    ).toBe(false)
    expect(cache.size()).toBe(2)

    // Switching wallet -> clears all cached topics
    expect(
      cache.clearOnScopeChange({ walletAddress: 'GUSER2', network: 'testnet' }),
    ).toBe(true)
    expect(cache.size()).toBe(0)
    expect(cache.getLastValue('claims:GUSER1')).toBeNull()
  })
})

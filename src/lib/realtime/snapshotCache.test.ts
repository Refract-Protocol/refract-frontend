import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  RealtimeSnapshotCache,
  type SnapshotCacheRecord,
  type SnapshotStorageBackend,
} from './snapshotCache'

class FakeIndexedDbBackend implements SnapshotStorageBackend {
  public readonly store = new Map<string, SnapshotCacheRecord>()
  public putCount = 0

  async get(key: string): Promise<SnapshotCacheRecord | undefined> {
    return this.store.get(key)
  }

  async put(record: SnapshotCacheRecord): Promise<void> {
    this.putCount += 1
    this.store.set(record.key, record)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async getAll(): Promise<SnapshotCacheRecord[]> {
    return Array.from(this.store.values())
  }
}

describe('RealtimeSnapshotCache (#284)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces high-frequency writes, hydrates cold-start snapshots as stale, and guards against older overwrites', async () => {
    let now = 1_700_000_000_000
    const backend = new FakeIndexedDbBackend()
    const writerCache = new RealtimeSnapshotCache({
      backend,
      isServer: false,
      writeThrottleMs: 500,
      nowFn: () => now,
    })

    // Burst of 5 oracle updates within 500ms -> coalesced to a single IndexedDB put
    for (let i = 1; i <= 5; i++) {
      now += 50
      writerCache.writeSnapshot({
        network: 'testnet',
        topic: 'oracle:XLM/USD',
        data: { price: 0.12 + i * 0.001 },
        sequence: i,
        capturedAt: now,
      })
    }

    expect(backend.putCount).toBe(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(backend.putCount).toBe(1)

    // Attempt to write an older sequence (sequence=3 < 5) -> rejected by freshness guard
    const staleWriteAccepted = writerCache.writeSnapshot({
      network: 'testnet',
      topic: 'oracle:XLM/USD',
      data: { price: 0.09 },
      sequence: 3,
      capturedAt: now - 1_000,
    })
    expect(staleWriteAccepted).toBe(false)

    // Cold-start reader instance hydrates from the same IndexedDB backend
    const coldStartCache = new RealtimeSnapshotCache({
      backend,
      isServer: false,
      nowFn: () => now,
    })
    const hydrated = await coldStartCache.hydrate<{ price: number }>({
      network: 'testnet',
      topic: 'oracle:XLM/USD',
    })

    expect(hydrated).toEqual({
      topic: 'oracle:XLM/USD',
      data: { price: 0.125 },
      capturedAt: 1_700_000_000_250,
      sequence: 5,
      isStaleHydration: true,
    })
  })

  it('isolates snapshots across wallets and networks, evicts schema mismatches and quota overflow, and is a no-op in SSR', async () => {
    const now = 1_700_000_000_000
    const backend = new FakeIndexedDbBackend()
    const cache = new RealtimeSnapshotCache({
      backend,
      isServer: false,
      writeThrottleMs: 0,
      maxEntries: 2,
      nowFn: () => now,
    })

    // Cross-wallet and cross-network isolation
    cache.writeSnapshot({
      network: 'testnet',
      walletAddress: 'GWALLET_A',
      topic: 'claims:GWALLET_A',
      data: [{ id: 'claim-a' }],
      capturedAt: now + 10,
    })
    cache.writeSnapshot({
      network: 'testnet',
      walletAddress: 'GWALLET_B',
      topic: 'claims:GWALLET_B',
      data: [{ id: 'claim-b' }],
      capturedAt: now + 20,
    })

    expect(
      cache.readSync({
        network: 'testnet',
        walletAddress: 'GWALLET_A',
        topic: 'claims:GWALLET_A',
      })?.data
    ).toEqual([{ id: 'claim-a' }])
    expect(
      cache.readSync({
        network: 'mainnet',
        walletAddress: 'GWALLET_A',
        topic: 'claims:GWALLET_A',
      })
    ).toBeNull()

    // Writing a 3rd entry exceeds maxEntries=2 -> evicts oldest ('GWALLET_A' at now+10)
    cache.writeSnapshot({
      network: 'testnet',
      walletAddress: 'public',
      topic: 'pool:main',
      data: { tvl: '100' },
      capturedAt: now + 30,
    })

    expect(
      cache.readSync({
        network: 'testnet',
        walletAddress: 'GWALLET_A',
        topic: 'claims:GWALLET_A',
      })
    ).toBeNull()

    // Schema version mismatch in backend is discarded on hydrate
    await backend.put({
      key: 'testnet::public::oracle:XLM/USD',
      schemaVersion: 999,
      network: 'testnet',
      walletAddress: 'public',
      topic: 'oracle:XLM/USD',
      capturedAt: now,
      data: { price: 0.1 },
    })
    expect(
      await cache.hydrate({ network: 'testnet', topic: 'oracle:XLM/USD' })
    ).toBeNull()

    // SSR instance is a strict no-op
    const ssrCache = new RealtimeSnapshotCache({
      backend,
      isServer: true,
    })
    expect(
      ssrCache.writeSnapshot({
        network: 'testnet',
        topic: 'pool:main',
        data: { tvl: '999' },
      })
    ).toBe(false)
    expect(
      await ssrCache.hydrate({ network: 'testnet', topic: 'pool:main' })
    ).toBeNull()
  })
})

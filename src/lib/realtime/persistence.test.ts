import { describe, expect, it } from 'vitest'
import {
  SubscriptionPersistenceStore,
  SUBSCRIPTION_STORAGE_KEY_PREFIX,
  type StorageLike,
} from './persistence'

class MockSessionStorage implements StorageLike {
  private readonly map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }
}

describe('SubscriptionPersistenceStore (#226)', () => {
  it('round-trips valid subscriptions and filters out unknown topics, mismatched wallet scopes, and oversized cursors', () => {
    const storage = new MockSessionStorage()
    const now = 1_700_000_000_000
    const store = new SubscriptionPersistenceStore({
      storage,
      nowFn: () => now,
      maxCursorLength: 16,
    })

    const scope = 'testnet:GABC123'
    store.save(scope, [
      { topic: 'oracle:XLM/USD', cursor: 'cur-100' },
      { topic: 'claims:GABC123', cursor: 42 },
      { topic: 'claims:GOTHER999', cursor: 'cur-foreign' }, // wrong wallet for scope
      { topic: 'unknown_family:foo', cursor: 'cur-bad' }, // invalid topic family
      { topic: 'pool:main', cursor: 'cursor-way-too-long-to-keep-in-storage' }, // cursor truncated to null
    ])

    const rehydrated = store.rehydrate(scope)
    expect(rehydrated).toEqual([
      {
        topic: 'oracle:XLM/USD',
        scope,
        cursor: 'cur-100',
        updatedAt: now,
      },
      {
        topic: 'claims:GABC123',
        scope,
        cursor: 42,
        updatedAt: now,
      },
      {
        topic: 'pool:main',
        scope,
        cursor: null,
        updatedAt: now,
      },
    ])
  })

  it('drops stale entries, invalidates schema-version mismatches, and recovers from corrupted JSON', () => {
    const storage = new MockSessionStorage()
    let now = 1_700_000_000_000
    const store = new SubscriptionPersistenceStore({
      storage,
      nowFn: () => now,
      maxAgeMs: 60_000,
    })

    const scope = 'testnet:GABC123'
    store.save(scope, [
      { topic: 'oracle:XLM/USD', cursor: 'old-cur', updatedAt: now - 120_000 },
      { topic: 'pool:main', cursor: 'fresh-cur', updatedAt: now - 10_000 },
    ])

    const active = store.rehydrate(scope)
    expect(active).toHaveLength(1)
    expect(active[0].topic).toBe('pool:main')

    // Write a mismatched schemaVersion payload
    const key = store.getStorageKey(scope)
    storage.setItem(
      key,
      JSON.stringify({
        schemaVersion: 999,
        scope,
        savedAt: now,
        subscriptions: [{ topic: 'pool:main', scope, cursor: '1', updatedAt: now }],
      })
    )
    expect(store.rehydrate(scope)).toEqual([])
    expect(storage.getItem(key)).toBeNull()

    // Write corrupted JSON
    storage.setItem(key, '{not-valid-json')
    expect(store.rehydrate(scope)).toEqual([])
    expect(storage.getItem(key)).toBeNull()
  })

  it('clears persisted subscriptions on scope change or explicit logout', () => {
    const storage = new MockSessionStorage()
    const store = new SubscriptionPersistenceStore({ storage })

    store.save('testnet:GWALLET1', [{ topic: 'oracle:XLM/USD', cursor: 'c1' }])
    store.save('mainnet:GWALLET2', [{ topic: 'pool:main', cursor: 'c2' }])
    storage.setItem('unrelated-app-key', 'keep-me')

    store.clearScope('testnet:GWALLET1')
    expect(store.rehydrate('testnet:GWALLET1')).toEqual([])
    expect(store.rehydrate('mainnet:GWALLET2')).toHaveLength(1)

    store.clearAll()
    expect(store.rehydrate('mainnet:GWALLET2')).toEqual([])
    expect(storage.getItem('unrelated-app-key')).toBe('keep-me')
    expect(SUBSCRIPTION_STORAGE_KEY_PREFIX).toContain('refract:realtime')
  })
})

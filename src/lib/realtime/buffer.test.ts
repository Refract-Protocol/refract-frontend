import { describe, expect, it } from 'vitest'
import {
  BoundedTopicBuffer,
  TopicBufferManager,
  resolveTopicRetentionPolicy,
} from './buffer'

describe('BoundedTopicBuffer & TopicBufferManager (#253)', () => {
  it('resolves documented per-topic retention policies and enforces FIFO eviction with stable keys', () => {
    const oraclePolicy = resolveTopicRetentionPolicy('oracle:XLM/USD')
    expect(oraclePolicy.maxEvents).toBe(200)
    expect(oraclePolicy.rationale.length).toBeGreaterThan(10)

    const buffer = new BoundedTopicBuffer<{ id: string; price: number }>({
      topic: 'oracle:XLM/USD',
      maxEvents: 3,
      getKey: (item) => item.id,
    })

    buffer.push({ id: 'tick-1', price: 0.11 })
    buffer.push({ id: 'tick-2', price: 0.12 })
    buffer.push({ id: 'tick-3', price: 0.13 })
    buffer.push({ id: 'tick-4', price: 0.14 })

    const entries = buffer.getEntries()
    expect(entries.map((e) => e.key)).toEqual(['tick-2', 'tick-3', 'tick-4'])

    const metrics = buffer.getMetrics()
    expect(metrics.size).toBe(3)
    expect(metrics.totalIngested).toBe(4)
    expect(metrics.droppedByCapacity).toBe(1)
  })

  it('preserves unread/protected items by evicting oldest unprotected items first and prunes expired items', () => {
    let now = 1_700_000_000_000
    const buffer = new BoundedTopicBuffer<{
      id: string
      unread: boolean
      ts: number
    }>({
      topic: 'notifications:GABC',
      maxEvents: 3,
      maxAgeMs: 10_000,
      nowFn: () => now,
      getKey: (item) => item.id,
      getTimestamp: (item) => item.ts,
      isProtected: (item) => item.unread,
    })

    buffer.push({ id: 'n-1-unread', unread: true, ts: now })
    buffer.push({ id: 'n-2-read', unread: false, ts: now + 100 })
    buffer.push({ id: 'n-3-read', unread: false, ts: now + 200 })

    // Pushing a 4th notification should evict 'n-2-read' (oldest read) rather than 'n-1-unread'
    buffer.push({ id: 'n-4-unread', unread: true, ts: now + 300 })

    expect(buffer.getEntries().map((e) => e.key)).toEqual([
      'n-1-unread',
      'n-3-read',
      'n-4-unread',
    ])

    // Advance clock past maxAgeMs (10,000ms): unprotected expired 'n-3-read' is pruned, unread survive
    now += 15_000
    const pruned = buffer.pruneExpired(now)
    expect(pruned).toBe(1)
    expect(buffer.getEntries().map((e) => e.key)).toEqual([
      'n-1-unread',
      'n-4-unread',
    ])
    expect(buffer.getMetrics().droppedByAge).toBe(1)
  })

  it('maintains bounded buffer size and accurate drop counters across 100,000 synthetic events', () => {
    const manager = new TopicBufferManager()
    const oracleBuffer = manager.getOrCreateBuffer<{ seq: number }>('oracle:XLM/USD', {
      maxEvents: 200,
      maxAgeMs: 0, // disable age pruning for pure throughput/capacity test
    })

    for (let i = 1; i <= 100_000; i++) {
      oracleBuffer.push({ seq: i })
    }

    const metrics = oracleBuffer.getMetrics()
    expect(metrics.size).toBe(200)
    expect(metrics.totalIngested).toBe(100_000)
    expect(metrics.droppedByCapacity).toBe(99_800)

    const values = oracleBuffer.getValues()
    expect(values[0].seq).toBe(99_801)
    expect(values[199].seq).toBe(100_000)
    expect(manager.getAllMetrics()).toHaveLength(1)
  })
})

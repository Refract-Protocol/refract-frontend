import { describe, expect, it } from 'vitest'
import {
  MessagePriorityScheduler,
  resolveTopicPriority,
} from './priorityScheduler'

describe('MessagePriorityScheduler (#258)', () => {
  it('classifies critical vs bulk topics and dispatches critical events ahead of a queued bulk backlog', () => {
    expect(resolveTopicPriority('claims:GABC')).toBe('critical')
    expect(resolveTopicPriority('tx:hash123')).toBe('critical')
    expect(resolveTopicPriority('auth:session')).toBe('critical')
    expect(resolveTopicPriority('oracle:XLM/USD')).toBe('bulk')
    expect(resolveTopicPriority('pool:main')).toBe('bulk')

    let now = 1_700_000_000_000
    const dispatchedOrder: Array<{ topic: string; id: string }> = []

    const scheduler = new MessagePriorityScheduler<{ id: string }>({
      nowFn: () => now,
      maxConsecutiveCritical: 10,
      onDispatch: (msg) => {
        now += 1
        dispatchedOrder.push({ topic: msg.topic, id: msg.payload.id })
      },
    })

    // Queue 5 bulk oracle messages first
    for (let i = 1; i <= 5; i++) {
      scheduler.enqueue({ topic: 'oracle:XLM/USD', payload: { id: `bulk-${i}` } })
    }

    // Queue 2 critical claim-settlement messages after the bulk flood
    scheduler.enqueue({ topic: 'claims:GABC', payload: { id: 'crit-1' } })
    scheduler.enqueue({ topic: 'claims:GABC', payload: { id: 'crit-2' } })

    scheduler.flushAll()

    // Critical messages overtake the bulk backlog while preserving per-topic order within each class
    expect(dispatchedOrder.map((d) => d.id)).toEqual([
      'crit-1',
      'crit-2',
      'bulk-1',
      'bulk-2',
      'bulk-3',
      'bulk-4',
      'bulk-5',
    ])

    const metrics = scheduler.getMetrics()
    expect(metrics.dispatchedCritical).toBe(2)
    expect(metrics.dispatchedBulk).toBe(5)
    expect(metrics.maxCriticalLatencyMs).toBeLessThanOrEqual(2)
  })

  it('prevents indefinite bulk starvation when continuous critical events arrive', () => {
    const dispatchedIds: string[] = []
    const scheduler = new MessagePriorityScheduler<{ id: string }>({
      maxConsecutiveCritical: 3,
      onDispatch: (msg) => dispatchedIds.push(msg.payload.id),
    })

    // Enqueue 2 bulk messages and 6 critical messages
    scheduler.enqueue({ topic: 'oracle:XLM/USD', payload: { id: 'bulk-1' } })
    scheduler.enqueue({ topic: 'oracle:XLM/USD', payload: { id: 'bulk-2' } })
    for (let i = 1; i <= 6; i++) {
      scheduler.enqueue({ topic: 'claims:GABC', payload: { id: `crit-${i}` } })
    }

    scheduler.flushAll()

    // After every 3 consecutive critical messages, 1 waiting bulk message is interleaved
    expect(dispatchedIds).toEqual([
      'crit-1',
      'crit-2',
      'crit-3',
      'bulk-1',
      'crit-4',
      'crit-5',
      'crit-6',
      'bulk-2',
    ])
  })

  it('caps memory per priority class and preserves strict per-topic ordering', () => {
    const dispatchedIds: string[] = []
    const scheduler = new MessagePriorityScheduler<{ id: string }>({
      maxBulkQueueSize: 3,
      onDispatch: (msg) => dispatchedIds.push(msg.payload.id),
    })

    for (let i = 1; i <= 5; i++) {
      scheduler.enqueue({ topic: 'pool:main', payload: { id: `pool-${i}` } })
    }

    scheduler.flushAll()

    expect(dispatchedIds).toEqual(['pool-3', 'pool-4', 'pool-5'])
    expect(scheduler.getMetrics().droppedBulk).toBe(2)
  })
})

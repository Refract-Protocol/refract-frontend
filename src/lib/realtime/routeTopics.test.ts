import { describe, expect, it, vi } from 'vitest'
import {
  resolveTopicsForRoute,
  RouteTopicNavigationManager,
} from './routeTopics'

describe('RouteTopicNavigationManager', () => {
  it('subscribes route topics on entry, preserves shared topics across transitions, and drains unused topics', () => {
    const subscribed: string[] = []
    const unsubscribed: string[] = []

    const manager = new RouteTopicNavigationManager({
      onSubscribeTopic: (t) => subscribed.push(t),
      onUnsubscribeTopic: (t) => unsubscribed.push(t),
    })

    // 1. Enter landing '/' -> ['oracle_update', 'claims:recent', 'protocol:stats']
    expect(manager.navigateTo('/')).toEqual([
      'oracle_update',
      'claims:recent',
      'protocol:stats',
    ])
    expect(subscribed).toEqual([
      'oracle_update',
      'claims:recent',
      'protocol:stats',
    ])

    // 2. Navigate to '/cover' -> shares 'oracle_update', adds 'policies:quotes' & 'protocol:parameters', drains 'claims:recent' & 'protocol:stats'
    subscribed.length = 0
    unsubscribed.length = 0
    expect(manager.navigateTo('/cover')).toEqual([
      'oracle_update',
      'policies:quotes',
      'protocol:parameters',
    ])
    expect(subscribed).toEqual(['policies:quotes', 'protocol:parameters'])
    expect(unsubscribed).toEqual(['claims:recent', 'protocol:stats'])

    // 3. Navigate to unmapped route '/legal/terms' -> drains route topics while hook-driven topic stays alive
    const releaseHook = manager.acquireHookTopic('custom:feed')
    expect(manager.navigateTo('/legal/terms')).toEqual(['custom:feed'])
    releaseHook()
    expect(manager.getActiveTopics()).toEqual([])
  })

  it('prefetches route topics on hover/focus and drains them if navigation does not occur before TTL', () => {
    vi.useFakeTimers()
    try {
      const unsubscribed: string[] = []
      const manager = new RouteTopicNavigationManager({
        prefetchTtlMs: 3_000,
        onUnsubscribeTopic: (t) => unsubscribed.push(t),
      })

      const prefetched = manager.prefetchRoute('/provide')
      expect(prefetched).toEqual([
        'pool:liquidity',
        'pool:activity',
        'protocol:parameters',
      ])
      expect(manager.getActiveTopics()).toHaveLength(3)

      vi.advanceTimersByTime(3_100)
      expect(manager.getActiveTopics()).toEqual([])
      expect(unsubscribed).toEqual([
        'pool:liquidity',
        'pool:activity',
        'protocol:parameters',
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('prevents unsubscribe/resubscribe thrash during rapid back/forward navigation within drainGraceMs', () => {
    vi.useFakeTimers()
    try {
      const subscribed: string[] = []
      const unsubscribed: string[] = []
      const manager = new RouteTopicNavigationManager({
        drainGraceMs: 300,
        onSubscribeTopic: (t) => subscribed.push(t),
        onUnsubscribeTopic: (t) => unsubscribed.push(t),
      })

      manager.navigateTo('/claims')
      expect(subscribed).toEqual(['claims:updates', 'claims:recent'])
      subscribed.length = 0

      // Navigate away to '/provide' and back to '/claims' within 150ms (< 300ms grace)
      manager.navigateTo('/provide')
      vi.advanceTimersByTime(150)
      manager.navigateTo('/claims')
      vi.advanceTimersByTime(500)

      // 'claims:updates' and 'claims:recent' were never unsubscribed or re-subscribed
      expect(unsubscribed).not.toContain('claims:updates')
      expect(subscribed).not.toContain('claims:updates')
      expect(resolveTopicsForRoute('/provide/pools/1')).toEqual([
        'pool:liquidity',
        'pool:activity',
        'protocol:parameters',
      ])
      manager.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

import { describe, expect, it } from 'vitest'
import { RealtimeToastLimiter } from './toastRateLimiter'

describe('RealtimeToastLimiter', () => {
  it('caps visible toasts, coalesces bursts into an expandable +N summary toast, and deduplicates across sources', () => {
    const limiter = new RealtimeToastLimiter({
      maxVisibleToasts: 2,
      maxToastsPerWindow: 2,
      windowMs: 10_000,
      now: () => 1_000,
    })

    expect(
      limiter.ingest({
        id: 'n-1',
        title: 'Pool deposit confirmed',
        priority: 'normal',
        category: 'pool',
        timestamp: 1_000,
        source: 'realtime',
      }),
    ).toBe('shown')

    // Duplicate from REST fallback is ignored
    expect(
      limiter.ingest({
        id: 'n-1',
        title: 'Pool deposit confirmed',
        priority: 'normal',
        category: 'pool',
        timestamp: 1_000,
        source: 'rest',
      }),
    ).toBe('duplicate')

    expect(
      limiter.ingest({
        id: 'n-2',
        title: 'Policy #12 renewed',
        priority: 'low',
        category: 'policy',
        timestamp: 1_010,
      }),
    ).toBe('shown')

    // Burst of 3 more normal notifications -> coalesced into a single expandable summary toast
    for (let i = 3; i <= 5; i += 1) {
      expect(
        limiter.ingest({
          id: `n-${i}`,
          title: `Update ${i}`,
          priority: 'normal',
          category: 'general',
          timestamp: 1_020 + i,
        }),
      ).toBe('coalesced')
    }

    const visible = limiter.getVisibleToasts()
    const summaries = visible.filter((t) => t.isSummary)
    expect(summaries).toHaveLength(1)
    expect(summaries[0].summaryLabel).toBe('+3 more notifications')
    expect(summaries[0].collapsedItems).toHaveLength(3)
  })

  it('never drops critical settlement confirmations and defers non-critical notifications during quiet hours', () => {
    const limiter = new RealtimeToastLimiter({
      maxVisibleToasts: 2,
      maxToastsPerWindow: 2,
      quietHours: { enabled: true, startHour: 22, endHour: 7 },
      getCurrentHour: () => 23, // 23:00 is inside quiet hours
      now: () => 5_000,
    })

    // Non-critical notification during quiet hours is deferred, not dropped
    expect(
      limiter.ingest({
        id: 'quiet-1',
        title: 'Governance vote opened',
        priority: 'normal',
        category: 'general',
        timestamp: 5_000,
      }),
    ).toBe('deferred')
    expect(limiter.getDeferredNotifications()).toHaveLength(1)
    expect(limiter.getVisibleToasts()).toHaveLength(0)

    // Critical claim settlement bypasses quiet hours and shows immediately
    expect(
      limiter.ingest({
        id: 'settle-1',
        title: 'Claim #99 payout settled (5,000 USDC)',
        priority: 'critical',
        category: 'settlement',
        timestamp: 5_100,
      }),
    ).toBe('shown')
    expect(limiter.getVisibleToasts()[0].id).toBe('settle-1')

    limiter.resetOnAccountSwitch()
    expect(limiter.getVisibleToasts()).toEqual([])
    expect(limiter.getDeferredNotifications()).toEqual([])
  })
})

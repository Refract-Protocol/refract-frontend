import { describe, expect, it } from 'vitest'
import { WebPushClaimNotificationCoordinator } from './webPushClaims'

const SAMPLE_VAPID_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtHQ3O4w7s9w4fH1m2P8s0k9L3vR6t5Y8u1I4o7P0a2S5d8F1g'

describe('WebPushClaimNotificationCoordinator', () => {
  it('never prompts on page_load or when opted-out/denied, and prompts on post_purchase', async () => {
    let promptCalls = 0
    const coord = new WebPushClaimNotificationCoordinator({
      vapidPublicKey: SAMPLE_VAPID_KEY,
      browserSupported: true,
      requestBrowserPermission: async () => {
        promptCalls += 1
        return 'granted'
      },
    })

    // Never prompt on page_load
    expect(await coord.requestPermission('page_load')).toEqual({
      prompted: false,
      status: 'default',
    })
    expect(promptCalls).toBe(0)

    // Respect user opt-out
    coord.setUserOptOut(true)
    expect(await coord.requestPermission('post_purchase')).toEqual({
      prompted: false,
      status: 'default',
    })

    // Opt back in and trigger post_purchase -> prompts once
    coord.setUserOptOut(false)
    expect(await coord.requestPermission('post_purchase')).toEqual({
      prompted: true,
      status: 'granted',
    })
    expect(promptCalls).toBe(1)
  })

  it('suppresses duplicate push when claimed by an open tab and strips sensitive fields on closed-tab push', () => {
    let tabOpen = true
    const coord = new WebPushClaimNotificationCoordinator({
      vapidPublicKey: SAMPLE_VAPID_KEY,
      initialPermission: 'granted',
      hasOpenVisibleTab: () => tabOpen,
    })

    // 1. Open tab claims event 'evt-claim-77' -> push is suppressed
    coord.claimEventInOpenTab('evt-claim-77')
    tabOpen = false
    expect(
      coord.evaluateIncomingPush({
        eventId: 'evt-claim-77',
        eventType: 'claim_settled',
        claimId: 'claim-77',
      }).shouldDisplay,
    ).toBe(false)

    // 2. Closed tab receives unclaimed event 'evt-claim-88' -> displays sanitized notification with deep link
    const closedTabPush = coord.evaluateIncomingPush({
      eventId: 'evt-claim-88',
      eventType: 'claim_settled',
      claimId: 'claim-88',
      walletAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      payoutAmountUsd: 125_000,
    })

    expect(closedTabPush.shouldDisplay).toBe(true)
    expect(closedTabPush.notification?.deepLinkUrl).toBe(
      '/claims?claimId=claim-88',
    )
    const serialized = JSON.stringify(closedTabPush.notification)
    expect(serialized).not.toContain(
      'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
    )
    expect(serialized).not.toContain('125000')
  })
})

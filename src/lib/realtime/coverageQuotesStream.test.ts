import { describe, expect, it } from 'vitest'
import { CoverageQuotesStreamController } from './coverageQuotesStream'

describe('CoverageQuotesStreamController', () => {
  it('subscribes per risk-class and duration, coalesces rapid quote pushes, and tears down on switch', () => {
    const subscribed: string[] = []
    const unsubscribed: string[] = []
    let flushFrame: (() => void) | null = null

    const controller = new CoverageQuotesStreamController({
      onSubscribeTopic: (t) => subscribed.push(t),
      onUnsubscribeTopic: (t) => unsubscribed.push(t),
      scheduleFrame: (cb) => {
        flushFrame = cb
        return () => {
          flushFrame = null
        }
      },
    })

    expect(controller.selectQuoteParameters('validator-slashing', 30)).toBe(
      'quotes:validator-slashing:30d',
    )
    expect(subscribed).toEqual(['quotes:validator-slashing:30d'])

    controller.applyRestQuote({
      riskClass: 'validator-slashing',
      durationDays: 30,
      coverageAmountUsd: 10_000,
      premiumUsd: 120,
      annualRateBps: 146,
      coverageLimitUsd: 500_000,
      expiresAt: 2_000,
      updatedAt: 1_000,
      sequence: 1,
    })

    // Push 3 rapid updates in one animation frame -> coalesces to the latest
    for (const [idx, prem] of [122, 125, 128].entries()) {
      controller.pushRealtimeQuote({
        riskClass: 'validator-slashing',
        durationDays: 30,
        coverageAmountUsd: 10_000,
        premiumUsd: prem,
        annualRateBps: 155,
        coverageLimitUsd: 500_000,
        expiresAt: 2_500,
        updatedAt: 1_100 + idx,
        sequence: 2 + idx,
      })
    }

    flushFrame!()
    expect(controller.getState().quote?.premiumUsd).toBe(128)
    expect(controller.getState().updatedJustNow).toBe(true)

    // Switch risk class -> unsubscribes previous topic and subscribes new topic
    controller.selectQuoteParameters('smart-contract-exploit', 90)
    expect(unsubscribed).toEqual(['quotes:validator-slashing:30d'])
    expect(subscribed).toEqual([
      'quotes:validator-slashing:30d',
      'quotes:smart-contract-exploit:90d',
    ])
  })

  it('requires explicit re-confirmation when premium changes during confirm step and ignores pushes after submit click', () => {
    const controller = new CoverageQuotesStreamController({
      scheduleFrame: (cb) => {
        cb()
        return () => {}
      },
    })

    controller.selectQuoteParameters('depeg-usdc', 30)
    controller.applyRestQuote({
      riskClass: 'depeg-usdc',
      durationDays: 30,
      coverageAmountUsd: 25_000,
      premiumUsd: 200,
      annualRateBps: 96,
      coverageLimitUsd: 1_000_000,
      expiresAt: 5_000,
      updatedAt: 1_000,
      sequence: 1,
    })

    // User enters confirm step at $200 premium
    controller.startConfirmStep()
    expect(controller.getState().confirmedPremiumUsd).toBe(200)
    expect(controller.getState().requiresReconfirm).toBe(false)

    // Mid-confirm push raises premium to $215 -> gates submit until acknowledged
    controller.pushRealtimeQuote({
      riskClass: 'depeg-usdc',
      durationDays: 30,
      coverageAmountUsd: 25_000,
      premiumUsd: 215,
      annualRateBps: 104,
      coverageLimitUsd: 1_000_000,
      expiresAt: 6_000,
      updatedAt: 1_500,
      sequence: 2,
    })

    expect(controller.getState().requiresReconfirm).toBe(true)
    expect(controller.beginSubmitTransaction()).toEqual({
      allowed: false,
      reason: 'reconfirm_required',
    })

    // User acknowledges new price -> submit succeeds
    controller.acknowledgePriceChange()
    const submitResult = controller.beginSubmitTransaction()
    expect(submitResult.allowed).toBe(true)
    expect(submitResult.submittedQuote?.premiumUsd).toBe(215)

    // Any push arriving after submit click is discarded
    controller.pushRealtimeQuote({
      riskClass: 'depeg-usdc',
      durationDays: 30,
      coverageAmountUsd: 25_000,
      premiumUsd: 300,
      annualRateBps: 140,
      coverageLimitUsd: 1_000_000,
      expiresAt: 7_000,
      updatedAt: 2_000,
      sequence: 3,
    })
    expect(controller.getState().quote?.premiumUsd).toBe(215)
    controller.dispose()
  })
})

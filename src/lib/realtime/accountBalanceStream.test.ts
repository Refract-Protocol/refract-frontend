import { describe, expect, it } from 'vitest'
import { AccountBalanceStreamController } from './accountBalanceStream'

describe('AccountBalanceStreamController', () => {
  it('applies authoritative balances, supports optimistic deductions, and reconciles on push event', () => {
    const subscribed: string[] = []
    const controller = new AccountBalanceStreamController({
      initialAccountId: 'GUSER1',
      initialNetwork: 'testnet',
      now: () => 1_000,
      onSubscribeTopic: (t) => subscribed.push(t),
    })

    expect(subscribed).toEqual(['account:testnet:GUSER1'])
    expect(controller.getState().isLoading).toBe(true)

    controller.applyAccountSnapshot({
      accountId: 'GUSER1',
      network: 'testnet',
      sequence: '100',
      subentryCount: 2,
      updatedAt: 1_000,
      balances: [
        { assetCode: 'XLM', balance: '500.0000000', decimals: 7 },
        {
          assetCode: 'USDC',
          assetIssuer: 'GISSUER',
          balance: '1200.0000000',
          decimals: 7,
        },
      ],
    })

    expect(controller.getState().balances['USDC:GISSUER'].balance).toBe(
      '1200.0000000',
    )

    // Optimistic deduction of 250 USDC after cover purchase
    controller.applyOptimisticDelta('USDC:GISSUER', -250)
    expect(controller.getState().balances['USDC:GISSUER'].balance).toBe(
      '950.0000000',
    )
    expect(controller.getState().hasPendingOptimisticDelta).toBe(true)

    // Authoritative push arrives at sequence 101 -> reconciles optimistic delta
    controller.applyAccountSnapshot({
      accountId: 'GUSER1',
      network: 'testnet',
      sequence: '101',
      subentryCount: 2,
      updatedAt: 2_000,
      balances: [
        { assetCode: 'XLM', balance: '499.9999000', decimals: 7 },
        {
          assetCode: 'USDC',
          assetIssuer: 'GISSUER',
          balance: '950.0000000',
          decimals: 7,
        },
      ],
    })

    expect(controller.getState().hasPendingOptimisticDelta).toBe(false)
    expect(controller.getState().sequence).toBe('101')
  })

  it('handles Horizon 404 unfunded accounts cleanly and isolates state across wallet/network switches', () => {
    const subscribed: string[] = []
    const unsubscribed: string[] = []
    const controller = new AccountBalanceStreamController({
      initialAccountId: 'GNEWACCOUNT',
      initialNetwork: 'testnet',
      onSubscribeTopic: (t) => subscribed.push(t),
      onUnsubscribeTopic: (t) => unsubscribed.push(t),
    })

    controller.markAccountUnfunded()
    expect(controller.getState().isUnfunded).toBe(true)
    expect(controller.getState().balances.XLM.balance).toBe('0.0000000')

    // Switch network to mainnet -> tears down testnet subscription and prevents cross-network bleed
    controller.setScope('GNEWACCOUNT', 'mainnet')
    expect(unsubscribed).toEqual(['account:testnet:GNEWACCOUNT'])
    expect(subscribed).toEqual([
      'account:testnet:GNEWACCOUNT',
      'account:mainnet:GNEWACCOUNT',
    ])
    expect(controller.getState().balances).toEqual({})

    // Late testnet event is rejected while on mainnet
    expect(
      controller.applyAccountSnapshot({
        accountId: 'GNEWACCOUNT',
        network: 'testnet',
        sequence: '50',
        subentryCount: 1,
        updatedAt: 3_000,
        balances: [{ assetCode: 'XLM', balance: '999.0000000', decimals: 7 }],
      }),
    ).toBe(false)

    controller.dispose()
  })
})

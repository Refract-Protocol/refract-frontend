import { describe, expect, it } from 'vitest'
import { FIXTURE_ORACLE_READINGS } from '../../fixtures/oracle'
import { FIXTURE_POOL_STATS } from '../../fixtures/poolStats'
import {
  mapClaimRealtimePayload,
  mapNotificationRealtimePayload,
  mapOracleRealtimePayload,
  mapPoolStatsRealtimePayload,
  mapTopicPayloadToDomain,
} from './index'

describe('Realtime Domain Mappers (#261)', () => {
  it('maps wire oracle and pool payloads to exact REST fixture domain shapes', () => {
    const restOracle = FIXTURE_ORACLE_READINGS[0]
    const mappedOracle = mapOracleRealtimePayload({
      coverage_type: restOracle.coverageType,
      value: restOracle.value,
      threshold: restOracle.threshold,
      severity: restOracle.severity,
      message: restOracle.message,
    })

    expect(mappedOracle).toEqual({
      ok: true,
      value: restOracle,
    })

    const mappedPool = mapPoolStatsRealtimePayload({
      total_usdc: FIXTURE_POOL_STATS.totalUsdc,
      total_shares: FIXTURE_POOL_STATS.totalShares,
      locked_usdc: FIXTURE_POOL_STATS.lockedUsdc,
      premium_accrued: FIXTURE_POOL_STATS.premiumAccrued,
      available_usdc: FIXTURE_POOL_STATS.availableUsdc,
      utilization_bps: FIXTURE_POOL_STATS.utilizationBps,
      apy_bps: FIXTURE_POOL_STATS.apyBps,
      share_price: FIXTURE_POOL_STATS.sharePrice,
      max_utilization_bps: FIXTURE_POOL_STATS.maxUtilizationBps,
    })

    expect(mappedPool).toEqual({
      ok: true,
      value: FIXTURE_POOL_STATS,
    })
  })

  it('normalizes ISO timestamps and base-unit string amounts for claims and notifications', () => {
    const isoDate = '2026-05-01T12:00:00.000Z'
    const expectedMs = Date.parse(isoDate)

    const claimRes = mapClaimRealtimePayload({
      policy_id: 14,
      claimant: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      coverage_type: 'StablecoinDepeg',
      triggered: true,
      payout_amount: '50000000000',
      reason: 'USDC traded at $0.931',
      processed_at: isoDate,
    })

    expect(claimRes).toEqual({
      ok: true,
      value: {
        policyId: 14,
        holder: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        coverageType: 'StablecoinDepeg',
        triggered: true,
        payout: '50000000000',
        reason: 'USDC traded at $0.931',
        processedAt: expectedMs,
      },
    })

    const notifRes = mapNotificationRealtimePayload({
      notification_id: 'notif-88',
      type: 'claim_settled',
      title: 'Claim Paid',
      body: '5,000 USDC transferred to your wallet',
      created_at: expectedMs,
    })
    expect(notifRes).toEqual({
      ok: true,
      value: {
        id: 'notif-88',
        type: 'claim_settled',
        title: 'Claim Paid',
        message: '5,000 USDC transferred to your wallet',
        createdAt: expectedMs,
        read: false,
      },
    })
  })

  it('rejects unmappable, float-coerced, or unknown topic payloads with explicit failure reasons', () => {
    // Reject float numbers where base-unit stroop strings are required
    const badClaim = mapClaimRealtimePayload({
      policyId: 1,
      holder: 'GABC',
      coverageType: 'StablecoinDepeg',
      triggered: true,
      payout: 5000.25, // float instead of base-unit string
      reason: 'Depeg',
      processedAt: 1_700_000_000_000,
    })
    expect(badClaim.ok).toBe(false)

    // Reject unknown severity enum on oracle reading
    const badOracle = mapOracleRealtimePayload({
      coverageType: 'StablecoinDepeg',
      value: 1.0,
      threshold: 0.95,
      severity: 'apocalyptic',
      message: 'Invalid severity',
    })
    expect(badOracle.ok).toBe(false)

    // Reject unknown topic family in dispatcher
    const unknownTopic = mapTopicPayloadToDomain('unknown:xyz', {})
    expect(unknownTopic).toEqual({
      ok: false,
      reason: 'Unsupported realtime topic family: "unknown"',
    })
  })
})

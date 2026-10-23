import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROTOCOL_PARAMETERS,
  ProtocolParametersStore,
  validateProtocolParametersPayload,
} from './protocolParameters'

describe('ProtocolParametersStore & Validator', () => {
  it('rejects partial or unknown-key payloads and enforces monotonic parameter versions', () => {
    // Partial payload rejected
    expect(
      validateProtocolParametersPayload({ version: 2, updatedAt: 1_000 }).ok,
    ).toBe(false)

    // Unknown top-level key rejected
    expect(
      validateProtocolParametersPayload({
        ...DEFAULT_PROTOCOL_PARAMETERS,
        unexpectedField: true,
      }).ok,
    ).toBe(false)

    const store = new ProtocolParametersStore({
      ...DEFAULT_PROTOCOL_PARAMETERS,
      version: 3,
      updatedAt: 5_000,
    })

    // Out-of-order version 2 is rejected
    expect(
      store.applyIncomingPayload({
        ...DEFAULT_PROTOCOL_PARAMETERS,
        version: 2,
        updatedAt: 6_000,
      }).applied,
    ).toBe(false)

    // Newer version 4 is applied
    expect(
      store.applyIncomingPayload({
        ...DEFAULT_PROTOCOL_PARAMETERS,
        version: 4,
        updatedAt: 7_000,
        poolCapacityCeilingUsd: 15_000_000,
      }).applied,
    ).toBe(true)
    expect(store.getSnapshot().poolCapacityCeilingUsd).toBe(15_000_000)
  })

  it('surfaces an inline warning and clamps in-progress form values when a pushed ceiling lowers', () => {
    const store = new ProtocolParametersStore()

    // User has $800,000 entered for validator-slashing (initial limit $1,000,000)
    expect(
      store.evaluateInProgressForm({
        riskClass: 'validator-slashing',
        coverageAmountUsd: 800_000,
      }).valid,
    ).toBe(true)

    // Governance push lowers validator-slashing ceiling to $500,000
    store.applyIncomingPayload({
      ...DEFAULT_PROTOCOL_PARAMETERS,
      version: 2,
      updatedAt: 2_000,
      coverageLimitsByRiskClass: {
        ...DEFAULT_PROTOCOL_PARAMETERS.coverageLimitsByRiskClass,
        'validator-slashing': 500_000,
      },
    })

    const validation = store.evaluateInProgressForm({
      riskClass: 'validator-slashing',
      coverageAmountUsd: 800_000,
    })

    expect(validation.valid).toBe(false)
    expect(validation.clampedCoverageAmountUsd).toBe(500_000)
    expect(validation.warningMessage).toContain('$500,000')
  })
})

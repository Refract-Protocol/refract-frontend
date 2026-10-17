import { describe, expect, it } from 'vitest'
import {
  computeRealtimeMessageMac,
  RealtimeIngressAuthenticator,
  validateRealtimeEndpointOrigin,
  type AuthBreadcrumb,
} from './messageAuth'

describe('Realtime Message Authentication & Origin Validation', () => {
  it('enforces scheme and allow-listed origins for realtime endpoints', () => {
    const allowedOrigins = [
      'wss://realtime.refract.finance',
      'https://realtime.refract.finance',
      'ws://localhost:8787',
    ]

    expect(
      validateRealtimeEndpointOrigin(
        'wss://realtime.refract.finance/v1/stream',
        { allowedOrigins, environment: 'production' },
      ),
    ).toEqual({
      valid: true,
      normalizedOrigin: 'wss://realtime.refract.finance',
    })

    // Rejects untrusted cross-origin host
    expect(
      validateRealtimeEndpointOrigin('wss://evil.example.com/v1/stream', {
        allowedOrigins,
        environment: 'production',
      }),
    ).toEqual({
      valid: false,
      reason: 'disallowed_origin',
    })

    // Rejects plaintext ws:// in production even on localhost
    expect(
      validateRealtimeEndpointOrigin('ws://localhost:8787/stream', {
        allowedOrigins,
        environment: 'production',
      }),
    ).toEqual({
      valid: false,
      reason: 'disallowed_scheme',
    })

    // Allows ws://localhost in development when allow-listed
    expect(
      validateRealtimeEndpointOrigin('ws://localhost:8787/stream', {
        allowedOrigins,
        environment: 'development',
      }),
    ).toEqual({
      valid: true,
      normalizedOrigin: 'ws://localhost:8787',
    })
  })

  it('verifies valid MAC signatures and rejects unsigned, forged, replayed, or expired messages', () => {
    let clock = 1_700_000_000_000
    const breadcrumbs: AuthBreadcrumb[] = []
    const sessionKey = 'session-secret-key-01'
    const sessionNonce = 'nonce-xyz'

    const auth = new RealtimeIngressAuthenticator({
      sessionKey,
      sessionNonce,
      environment: 'production',
      maxAgeMs: 30_000,
      maxFutureSkewMs: 5_000,
      now: () => clock,
      onRejected: (b) => breadcrumbs.push(b),
    })

    const payload = { claimId: 'claim-101', status: 'PAID', amount: '5000' }
    const validSig = computeRealtimeMessageMac(sessionKey, {
      eventId: 'evt-1',
      topic: 'claims:0xabc',
      timestamp: clock,
      payload,
      sessionNonce,
    })

    // 1. Valid signed message is accepted
    expect(
      auth.verifyEnvelope({
        eventId: 'evt-1',
        topic: 'claims:0xabc',
        timestamp: clock,
        payload,
        signature: validSig,
      }),
    ).toEqual({ accepted: true })

    // 2. Replaying the exact same signed message is rejected
    expect(
      auth.verifyEnvelope({
        eventId: 'evt-1',
        topic: 'claims:0xabc',
        timestamp: clock,
        payload,
        signature: validSig,
      }),
    ).toEqual({ accepted: false, reason: 'replayed_event_id' })

    // 3. Forged payload with original signature is rejected
    expect(
      auth.verifyEnvelope({
        eventId: 'evt-2',
        topic: 'claims:0xabc',
        timestamp: clock,
        payload: { ...payload, amount: '999999' },
        signature: validSig,
      }),
    ).toEqual({ accepted: false, reason: 'invalid_signature' })

    // 4. Unsigned event on protected topic is rejected
    expect(
      auth.verifyEnvelope({
        eventId: 'evt-3',
        topic: 'oracle:price_feed',
        timestamp: clock,
        payload: { price: 1.01 },
      }),
    ).toEqual({ accepted: false, reason: 'missing_signature' })

    // 5. Expired timestamp (> 30s old) is rejected
    expect(
      auth.verifyEnvelope({
        eventId: 'evt-4',
        topic: 'claims:0xabc',
        timestamp: clock - 45_000,
        payload,
        signature: validSig,
      }),
    ).toEqual({ accepted: false, reason: 'expired_timestamp' })

    expect(auth.getRejectionCounts()).toMatchObject({
      replayed_event_id: 1,
      invalid_signature: 1,
      missing_signature: 1,
      expired_timestamp: 1,
    })
    expect(breadcrumbs).toHaveLength(4)
  })

  it('never allows allowUnsignedInLocalMock bypass when environment is production', () => {
    const prodAuth = new RealtimeIngressAuthenticator({
      sessionKey: 'prod-key',
      environment: 'production',
      allowUnsignedInLocalMock: true,
      now: () => 1_000,
    })

    expect(
      prodAuth.verifyEnvelope({
        eventId: 'evt-prod-1',
        topic: 'claims:0x1',
        timestamp: 1_000,
        payload: { ok: true },
      }),
    ).toEqual({ accepted: false, reason: 'missing_signature' })

    const devMockAuth = new RealtimeIngressAuthenticator({
      sessionKey: 'dev-key',
      environment: 'development',
      allowUnsignedInLocalMock: true,
      now: () => 1_000,
    })

    expect(
      devMockAuth.verifyEnvelope({
        eventId: 'evt-dev-1',
        topic: 'claims:0x1',
        timestamp: 1_000,
        payload: { ok: true },
      }),
    ).toEqual({ accepted: true })
  })
})

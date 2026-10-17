import { describe, expect, it } from 'vitest'
import {
  SanitizedRealtimeLogger,
  sanitizeRealtimeDiagnosticValue,
  summarizeFrameForDiagnostics,
} from './redact'

const SEEDED_PUBLIC_KEY =
  'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'
const SEEDED_SECRET_KEY =
  'SBK2VIYYSVG76E7VC3Q6252EA2345672345672345672345672345672'
const SEEDED_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
const SEEDED_XDR = 'AAAAAgAAAABexf392817263548910293847561029384756=='

describe('PII Redaction & SanitizedRealtimeLogger (#282)', () => {
  it('redacts wallet addresses, secret seeds, JWTs, signed XDRs, and raw frames while keeping topic and sequence visible', () => {
    const errorWithContext = Object.assign(
      new Error(`Auth failed for ${SEEDED_PUBLIC_KEY} using Bearer ${SEEDED_JWT}`),
      {
        code: 'AUTH_REJECTED',
        token: SEEDED_JWT,
        rawFrame: `{"topic":"claims:${SEEDED_PUBLIC_KEY}","secret":"${SEEDED_SECRET_KEY}"}`,
      }
    )

    const input = {
      topic: `claims:${SEEDED_PUBLIC_KEY}`,
      sequence: 42,
      byteLength: 256,
      authToken: SEEDED_JWT,
      signedXdr: SEEDED_XDR,
      nested: [
        {
          holder: SEEDED_PUBLIC_KEY,
          privateKey: SEEDED_SECRET_KEY,
          longField: 'x'.repeat(200),
        },
      ],
      err: errorWithContext,
    }

    const sanitized = sanitizeRealtimeDiagnosticValue(input, {
      maxStringLength: 80,
    })
    const serialized = JSON.stringify(sanitized)

    // None of the seeded secrets or full wallet addresses appear anywhere in the output
    expect(serialized).not.toContain(SEEDED_PUBLIC_KEY)
    expect(serialized).not.toContain(SEEDED_SECRET_KEY)
    expect(serialized).not.toContain(SEEDED_JWT)
    expect(serialized).not.toContain(SEEDED_XDR)

    // Diagnostic fields remain intact for debugging
    const obj = sanitized as Record<string, unknown>
    expect(obj.sequence).toBe(42)
    expect(obj.byteLength).toBe(256)
    expect(String(obj.topic)).toContain('claims:GBRP...OX2H[REDACTED]')
    expect(obj.authToken).toBe('[REDACTED_SECRET]')
    expect(obj.signedXdr).toBe('[REDACTED_SECRET]')

    const errObj = obj.err as Record<string, unknown>
    expect(errObj.code).toBe('AUTH_REJECTED')
    expect(String(errObj.rawFrame)).toMatch(/^\[REDACTED_FRAME:\d+B\]$/)
  })

  it('suppresses verbose frame logs in production by default and scrubs all logger sink arguments', () => {
    const capturedLogs: Array<{ level: string; args: unknown[] }> = []
    const sink = {
      debug: (...args: unknown[]) => capturedLogs.push({ level: 'debug', args }),
      info: (...args: unknown[]) => capturedLogs.push({ level: 'info', args }),
      warn: (...args: unknown[]) => capturedLogs.push({ level: 'warn', args }),
      error: (...args: unknown[]) => capturedLogs.push({ level: 'error', args }),
    }

    const logger = new SanitizedRealtimeLogger({
      isProduction: true,
      sink,
    })

    // In production, debug and info are suppressed by default
    logger.debug('Inbound frame', { wallet: SEEDED_PUBLIC_KEY })
    logger.info('Subscribed', { token: SEEDED_JWT })
    expect(capturedLogs).toHaveLength(0)

    // Warn and error are emitted with full PII sanitization
    logger.warn(
      `Connection degraded for ${SEEDED_PUBLIC_KEY}`,
      summarizeFrameForDiagnostics({
        type: 'event',
        topic: `claims:${SEEDED_PUBLIC_KEY}`,
        sequence: 9,
        rawByteLength: 512,
      })
    )
    expect(capturedLogs).toHaveLength(1)
    expect(JSON.stringify(capturedLogs[0].args)).not.toContain(SEEDED_PUBLIC_KEY)

    // Enabling runtime verbose debug switch permits debug logs (still sanitized)
    logger.setVerboseDebug(true)
    logger.debug(`Debugging ${SEEDED_SECRET_KEY}`)
    expect(capturedLogs).toHaveLength(2)
    expect(JSON.stringify(capturedLogs[1].args)).not.toContain(SEEDED_SECRET_KEY)
  })
})

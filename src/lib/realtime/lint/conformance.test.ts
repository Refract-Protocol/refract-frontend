import { describe, expect, it } from 'vitest'
import {
  lintRealtimeSourceFile,
  REALTIME_ESLINT_AST_SELECTORS,
} from './conformance'

describe('Realtime Conformance Linter', () => {
  it('flags bare WebSocket/EventSource construction, deep imports, and unscoped component subscriptions', () => {
    const invalidComponent = [
      "import { realtimeClient } from '@/lib/realtime/client'",
      'export function BadOracleWidget() {',
      "  const ws = new WebSocket('wss://example.com/ws')",
      "  const es = new EventSource('/api/stream')",
      "  realtimeClient.subscribe('oracle_update', () => {})",
      '  return null',
      '}',
    ].join('\n')

    const res = lintRealtimeSourceFile(
      'src/components/BadOracleWidget.tsx',
      invalidComponent,
    )

    expect(res.valid).toBe(false)
    expect(res.violations.map((v) => v.ruleId)).toEqual([
      'no-deep-realtime-import',
      'no-direct-transport-construction',
      'no-direct-transport-construction',
      'no-unscoped-realtime-subscribe',
    ])
    expect(REALTIME_ESLINT_AST_SELECTORS).toHaveLength(2)
  })

  it('allows public barrel imports, type-only deep imports, and exempts src/lib/realtime/** and test files', () => {
    const validComponent = [
      "import { realtimeClient } from '@/lib/realtime'",
      "import type { ValidatedWireFrame } from '@/lib/realtime/wireDecoder'",
      "import { useEffect } from 'react'",
      'export function GoodWidget() {',
      '  useEffect(() => {',
      "    return realtimeClient.subscribe('oracle_update', () => {})",
      '  }, [])',
      '  return null',
      '}',
    ].join('\n')

    expect(
      lintRealtimeSourceFile('src/components/GoodWidget.tsx', validComponent)
        .valid,
    ).toBe(true)

    expect(
      lintRealtimeSourceFile(
        'src/lib/realtime/client.ts',
        "const s = new WebSocket('wss://localhost')",
      ).valid,
    ).toBe(true)

    expect(
      lintRealtimeSourceFile(
        'src/components/Widget.test.tsx',
        "const s = new WebSocket('wss://localhost')",
      ).valid,
    ).toBe(true)
  })

  it('requires a non-empty justification comment for realtime-lint-ignore escape hatches', () => {
    const missingReason = [
      '// realtime-lint-ignore:',
      "const ws = new WebSocket('wss://legacy.example.com')",
    ].join('\n')

    const badRes = lintRealtimeSourceFile(
      'src/components/LegacyStream.tsx',
      missingReason,
    )
    expect(badRes.valid).toBe(false)
    expect(badRes.violations[0].ruleId).toBe('missing-ignore-justification')

    const justified = [
      '// realtime-lint-ignore: temporary bridge for isolated wallet hardware popup',
      "const ws = new WebSocket('wss://legacy.example.com')",
    ].join('\n')

    expect(
      lintRealtimeSourceFile('src/components/LegacyStream.tsx', justified).valid,
    ).toBe(true)
  })
})

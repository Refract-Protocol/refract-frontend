import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/client', () => ({
  API_BASE_URL: 'https://api.refract.finance/api/v1',
}))

import {
  REALTIME_TOPICS,
  realtimeClient,
  validateRealtimeModuleImport,
} from './index'

describe('Realtime Module Boundary & Public Entry Point', () => {
  it('exports the supported public surface from src/lib/realtime/index.ts', () => {
    expect(realtimeClient).toBeDefined()
    expect(typeof realtimeClient.subscribe).toBe('function')
    expect(typeof realtimeClient.connect).toBe('function')
    expect(typeof realtimeClient.disconnect).toBe('function')
    expect(REALTIME_TOPICS.ORACLE_UPDATE).toBe('oracle_update')
    expect(REALTIME_TOPICS.CLAIMS_UPDATES).toBe('claims:updates')
  })

  it('allows public barrel imports and internal imports, but rejects external deep imports', () => {
    // Public barrel import from a hook -> allowed
    expect(
      validateRealtimeModuleImport(
        'src/hooks/useClaimsFeed.ts',
        '@/lib/realtime',
      ),
    ).toEqual({ allowed: true })

    // Deep import from a component -> rejected
    const violation = validateRealtimeModuleImport(
      'src/components/Navbar.tsx',
      '@/lib/realtime/client',
    )
    expect(violation.allowed).toBe(false)
    expect(violation.reason).toContain('Import from "@/lib/realtime" instead')

    // Relative deep import from outside src/lib/realtime -> rejected
    expect(
      validateRealtimeModuleImport(
        'src/hooks/useOracle.ts',
        '../lib/realtime/client',
      ).allowed,
    ).toBe(false)

    // Internal import within src/lib/realtime/** -> allowed
    expect(
      validateRealtimeModuleImport(
        'src/lib/realtime/client.test.ts',
        '@/lib/realtime/client',
      ),
    ).toEqual({ allowed: true })
  })

  it('configures no-restricted-imports in .eslintrc.json with an override for src/lib/realtime/**', () => {
    const eslintPath = resolve(process.cwd(), '.eslintrc.json')
    const eslintConfig = JSON.parse(readFileSync(eslintPath, 'utf8'))

    const restrictedRule = eslintConfig.rules?.['no-restricted-imports']
    expect(restrictedRule).toBeDefined()
    expect(restrictedRule[0]).toBe('error')
    expect(restrictedRule[1].patterns[0].group).toContain('@/lib/realtime/*')

    const realtimeOverride = eslintConfig.overrides?.find(
      (o: { files?: string[] }) =>
        Array.isArray(o.files) && o.files.includes('src/lib/realtime/**'),
    )
    expect(realtimeOverride?.rules?.['no-restricted-imports']).toBe('off')
  })
})

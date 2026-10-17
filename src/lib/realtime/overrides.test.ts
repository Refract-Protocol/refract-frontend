import { describe, expect, it } from 'vitest'
import {
  RealtimeOverrideResolver,
  parseRealtimeOverrideFromQuery,
  type SessionStorageLike,
} from './overrides'

class MemorySessionStorage implements SessionStorageLike {
  private readonly map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

describe('RealtimeOverrideResolver (#279)', () => {
  it('honors ?realtime=ws|sse|mock|off in dev/QA environments, exposes badge labels, and excludes overrides from telemetry', () => {
    expect(
      parseRealtimeOverrideFromQuery(
        '?realtime=sse&realtimeEndpoint=https://staging.refract.finance/sse'
      )
    ).toEqual({
      mode: 'sse',
      endpoint: 'https://staging.refract.finance/sse',
    })

    const transitions: string[] = []
    const storage = new MemorySessionStorage()
    const resolver = new RealtimeOverrideResolver({
      isProduction: false,
      hostname: 'localhost',
      sessionStorage: storage,
      onTransportChanged: (prev, next) => {
        transitions.push(`${prev?.transport}->${next.transport}`)
      },
    })

    // 1. Default when envEnabled is false
    const initial = resolver.resolve({ envEnabled: false })
    expect(initial.enabled).toBe(false)
    expect(initial.transport).toBe('rest')
    expect(initial.isOverridden).toBe(false)

    // 2. Switch via query param ?realtime=mock
    const mockResolved = resolver.resolve({
      envEnabled: false,
      querySearch: '?realtime=mock',
    })
    expect(mockResolved.enabled).toBe(true)
    expect(mockResolved.transport).toBe('mock')
    expect(mockResolved.endpoint).toBe('ws://localhost:4010/realtime')
    expect(mockResolved.overrideBadgeLabel).toBe('QA Override: MOCK')
    expect(mockResolved.includeInTelemetry).toBe(false)
    expect(transitions).toEqual(['rest->mock'])

    // 3. Hot-swap to ?realtime=sse
    const sseResolved = resolver.resolve({
      envEnabled: false,
      querySearch: '?realtime=sse',
    })
    expect(sseResolved.transport).toBe('sse')
    expect(sseResolved.overrideBadgeLabel).toBe('QA Override: SSE')
    expect(transitions).toEqual(['rest->mock', 'mock->sse'])

    // 4. Reset to defaults clears persisted override
    resolver.resetToDefaults()
    const afterReset = resolver.resolve({ envEnabled: false })
    expect(afterReset.isOverridden).toBe(false)
    expect(afterReset.transport).toBe('rest')
  })

  it('enforces precedence chain: remote kill switch always beats overrides in production and non-allowlisted prod hosts ignore overrides', () => {
    // Production on main user-facing domain (`app.refract.finance`) -> overrides are completely inert
    const prodUserHostResolver = new RealtimeOverrideResolver({
      isProduction: true,
      hostname: 'app.refract.finance',
    })

    const prodAttempt = prodUserHostResolver.resolve({
      envEnabled: false,
      querySearch: '?realtime=ws',
    })
    expect(prodAttempt.enabled).toBe(false)
    expect(prodAttempt.isOverridden).toBe(false)

    // Production on allowlisted QA host (`staging.refract.finance`) -> override works UNLESS kill switch is tripped
    const stagingResolver = new RealtimeOverrideResolver({
      isProduction: true,
      hostname: 'staging.refract.finance',
    })

    const stagingOverride = stagingResolver.resolve({
      killSwitchTripped: false,
      envEnabled: false,
      querySearch: '?realtime=ws',
    })
    expect(stagingOverride.enabled).toBe(true)
    expect(stagingOverride.source).toBe('qa_override')

    // When remote kill switch trips in production, it beats the QA override
    const killedInProd = stagingResolver.resolve({
      killSwitchTripped: true,
      envEnabled: true,
    })
    expect(killedInProd.enabled).toBe(false)
    expect(killedInProd.transport).toBe('rest')
    expect(killedInProd.source).toBe('kill_switch')
  })
})

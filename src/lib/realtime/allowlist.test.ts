import { describe, expect, it } from 'vitest'
import {
  RealtimeOriginAllowlistError,
  assertAllowedRealtimeEndpoint,
  buildRealtimeConnectSrcCspHeader,
  resolveRealtimeEndpointAllowlist,
} from './allowlist'

describe('Realtime Endpoint Allowlist & CSP connect-src Builder (#274)', () => {
  it('generates network-aware allowlists and CSP connect-src headers in Report-Only and Enforced modes', () => {
    const testnetAllowlist = resolveRealtimeEndpointAllowlist({
      network: 'testnet',
      apiUrl: 'https://preview-42.refract.finance/api/v1',
    })

    expect(testnetAllowlist.allowedOrigins).toContain(
      'https://api-testnet.refract.finance'
    )
    expect(testnetAllowlist.allowedOrigins).toContain(
      'wss://api-testnet.refract.finance'
    )
    // Paired HTTPS + WSS origins derived from apiUrl
    expect(testnetAllowlist.allowedOrigins).toContain(
      'https://preview-42.refract.finance'
    )
    expect(testnetAllowlist.allowedOrigins).toContain(
      'wss://preview-42.refract.finance'
    )

    const reportOnlyCsp = buildRealtimeConnectSrcCspHeader(testnetAllowlist)
    expect(reportOnlyCsp.key).toBe('Content-Security-Policy-Report-Only')
    expect(reportOnlyCsp.value).toContain("connect-src 'self'")
    expect(reportOnlyCsp.value).toContain('wss://api-testnet.refract.finance')
    expect(reportOnlyCsp.value).toContain('wss://preview-42.refract.finance')
    expect(reportOnlyCsp.value).not.toContain('ws://localhost:*')

    const enforcedCsp = buildRealtimeConnectSrcCspHeader(testnetAllowlist, {
      enforce: true,
      reportUri: 'https://csp.refract.finance/report',
    })
    expect(enforcedCsp.key).toBe('Content-Security-Policy')
    expect(enforcedCsp.value).toContain(
      'report-uri https://csp.refract.finance/report;'
    )
  })

  it('permits allowlisted endpoints (and localhost ports in dev) while rejecting untrusted or unencrypted origins', () => {
    const mainnetAllowlist = resolveRealtimeEndpointAllowlist({
      network: 'mainnet',
    })

    // Valid mainnet WSS and HTTPS SSE endpoints succeed
    expect(
      assertAllowedRealtimeEndpoint(
        'wss://api.refract.finance/realtime/ws',
        mainnetAllowlist
      ).origin
    ).toBe('wss://api.refract.finance')

    expect(
      assertAllowedRealtimeEndpoint(
        'https://api.refract.finance/realtime/sse',
        mainnetAllowlist
      ).origin
    ).toBe('https://api.refract.finance')

    // Attacker-controlled origin is rejected with RealtimeOriginAllowlistError
    expect(() =>
      assertAllowedRealtimeEndpoint(
        'wss://evil-exfil.example.com/socket',
        mainnetAllowlist
      )
    ).toThrow(RealtimeOriginAllowlistError)

    // Unencrypted ws:// against mainnet host is rejected
    expect(() =>
      assertAllowedRealtimeEndpoint(
        'ws://api.refract.finance/realtime/ws',
        mainnetAllowlist
      )
    ).toThrow(RealtimeOriginAllowlistError)

    // Development allowlist permits arbitrary localhost ports
    const devAllowlist = resolveRealtimeEndpointAllowlist({
      network: 'development',
    })
    expect(
      assertAllowedRealtimeEndpoint(
        'ws://localhost:4567/realtime',
        devAllowlist
      ).host
    ).toBe('localhost:4567')
  })
})

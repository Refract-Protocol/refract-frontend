/**
 * Canonical realtime endpoint allowlist and CSP `connect-src` policy builder (#274).
 *
 * Ensures both the browser's Content-Security-Policy (`connect-src`) and the
 * runtime transport connection guard validate against the exact same network-aware
 * origin allowlist, preventing socket exfiltration to untrusted origins.
 */

export type RealtimeEnvironmentNetwork = 'development' | 'testnet' | 'mainnet'

export class RealtimeOriginAllowlistError extends Error {
  readonly code = 'DISALLOWED_REALTIME_ORIGIN' as const
  readonly targetUrl: string
  readonly targetOrigin: string
  readonly allowedOrigins: readonly string[]

  constructor(
    targetUrl: string,
    targetOrigin: string,
    allowedOrigins: readonly string[],
    reason?: string
  ) {
    super(
      reason ??
        `Realtime endpoint "${targetUrl}" (origin "${targetOrigin}") is not in the trusted allowlist: [${allowedOrigins.join(', ')}]`
    )
    this.name = 'RealtimeOriginAllowlistError'
    this.targetUrl = targetUrl
    this.targetOrigin = targetOrigin
    this.allowedOrigins = allowedOrigins
  }
}

export interface RealtimeAllowlistEnvInput {
  network?: RealtimeEnvironmentNetwork
  apiUrl?: string
  wsUrl?: string
  extraAllowedOrigins?: string | readonly string[]
  allowLocalhostWildcardPort?: boolean
}

export interface CanonicalRealtimeAllowlist {
  readonly network: RealtimeEnvironmentNetwork
  /** Exact allowed origins (`https://...`, `wss://...`, `http://localhost:3001`, etc.). */
  readonly allowedOrigins: readonly string[]
  /** Whether `ws://localhost:*` and `http://localhost:*` are permitted (development only). */
  readonly allowLocalhostWildcardPort: boolean
}

const DEFAULT_NETWORK_ORIGINS: Record<
  RealtimeEnvironmentNetwork,
  readonly string[]
> = {
  development: [
    'http://localhost:3000',
    'http://localhost:3001',
    'ws://localhost:3000',
    'ws://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001',
    'ws://127.0.0.1:3000',
    'ws://127.0.0.1:3001',
  ],
  testnet: [
    'https://api-testnet.refract.finance',
    'wss://api-testnet.refract.finance',
    'https://soroban-testnet.stellar.org',
    'https://horizon-testnet.stellar.org',
  ],
  mainnet: [
    'https://api.refract.finance',
    'wss://api.refract.finance',
    'https://horizon.stellar.org',
  ],
}

/**
 * Derives both the HTTP(S) and corresponding WS(S) origin for a given base URL.
 */
function derivePairedOrigins(rawUrl: string): string[] {
  try {
    const parsed = new URL(rawUrl.trim())
    const origin = `${parsed.protocol}//${parsed.host}`
    const results = new Set<string>([origin])

    if (parsed.protocol === 'https:') {
      results.add(`wss://${parsed.host}`)
    } else if (parsed.protocol === 'http:') {
      results.add(`ws://${parsed.host}`)
    } else if (parsed.protocol === 'wss:') {
      results.add(`https://${parsed.host}`)
    } else if (parsed.protocol === 'ws:') {
      results.add(`http://${parsed.host}`)
    }

    return Array.from(results)
  } catch {
    return []
  }
}

/**
 * Builds the canonical `CanonicalRealtimeAllowlist` for a given network and environment config.
 */
export function resolveRealtimeEndpointAllowlist(
  input: RealtimeAllowlistEnvInput = {}
): CanonicalRealtimeAllowlist {
  const network: RealtimeEnvironmentNetwork =
    input.network ??
    ((typeof process !== 'undefined' &&
      (process.env?.NEXT_PUBLIC_STELLAR_NETWORK as RealtimeEnvironmentNetwork)) ||
      'development')

  const origins = new Set<string>(DEFAULT_NETWORK_ORIGINS[network] ?? [])

  const apiUrl =
    input.apiUrl ??
    (typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_API_URL : undefined)
  if (apiUrl) {
    for (const o of derivePairedOrigins(apiUrl)) {
      origins.add(o)
    }
  }

  const wsUrl =
    input.wsUrl ??
    (typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_WS_URL : undefined)
  if (wsUrl) {
    for (const o of derivePairedOrigins(wsUrl)) {
      origins.add(o)
    }
  }

  const extra =
    input.extraAllowedOrigins ??
    (typeof process !== 'undefined'
      ? process.env?.NEXT_PUBLIC_REALTIME_ALLOWED_ORIGINS
      : undefined)

  if (typeof extra === 'string' && extra.trim()) {
    for (const part of extra.split(',')) {
      for (const o of derivePairedOrigins(part)) {
        origins.add(o)
      }
    }
  } else if (Array.isArray(extra)) {
    for (const part of extra) {
      for (const o of derivePairedOrigins(part)) {
        origins.add(o)
      }
    }
  }

  const allowLocalhostWildcardPort =
    input.allowLocalhostWildcardPort ?? network === 'development'

  return {
    network,
    allowedOrigins: Object.freeze(Array.from(origins)),
    allowLocalhostWildcardPort,
  }
}

const ALLOWED_SCHEMES = new Set(['ws:', 'wss:', 'http:', 'https:'])

/**
 * Validates a candidate WebSocket/SSE/Long-Poll endpoint URL against the
 * canonical allowlist. Throws `RealtimeOriginAllowlistError` if rejected.
 */
export function assertAllowedRealtimeEndpoint(
  endpointUrl: string,
  allowlist: CanonicalRealtimeAllowlist = resolveRealtimeEndpointAllowlist()
): URL {
  let parsed: URL
  try {
    parsed = new URL(endpointUrl)
  } catch {
    throw new RealtimeOriginAllowlistError(
      endpointUrl,
      'invalid-url',
      allowlist.allowedOrigins,
      `Malformed realtime endpoint URL: "${endpointUrl}"`
    )
  }

  const origin = `${parsed.protocol}//${parsed.host}`

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new RealtimeOriginAllowlistError(
      endpointUrl,
      origin,
      allowlist.allowedOrigins,
      `Unsupported realtime protocol "${parsed.protocol}" for "${endpointUrl}"`
    )
  }

  // In mainnet/testnet, disallow unencrypted ws: / http: unless explicitly allowlisted
  if (
    allowlist.network !== 'development' &&
    (parsed.protocol === 'ws:' || parsed.protocol === 'http:') &&
    !allowlist.allowedOrigins.includes(origin)
  ) {
    throw new RealtimeOriginAllowlistError(
      endpointUrl,
      origin,
      allowlist.allowedOrigins,
      `Unencrypted scheme "${parsed.protocol}" is not permitted on ${allowlist.network}`
    )
  }

  if (allowlist.allowedOrigins.includes(origin)) {
    return parsed
  }

  if (
    allowlist.allowLocalhostWildcardPort &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  ) {
    return parsed
  }

  throw new RealtimeOriginAllowlistError(
    endpointUrl,
    origin,
    allowlist.allowedOrigins
  )
}

export interface CspHeaderBuildOptions {
  /**
   * When true, emits `Content-Security-Policy` instead of
   * `Content-Security-Policy-Report-Only` (default: false — ships as Report-Only first).
   */
  enforce?: boolean
  /** Optional `report-uri` endpoint for CSP violation reports. */
  reportUri?: string
}

export interface CspHeaderDescriptor {
  key: 'Content-Security-Policy-Report-Only' | 'Content-Security-Policy'
  value: string
}

/**
 * Builds the `connect-src` CSP header descriptor from a `CanonicalRealtimeAllowlist`
 * so `next.config.js` headers and client-side transport checks stay in lockstep.
 */
export function buildRealtimeConnectSrcCspHeader(
  allowlist: CanonicalRealtimeAllowlist = resolveRealtimeEndpointAllowlist(),
  options: CspHeaderBuildOptions = {}
): CspHeaderDescriptor {
  const sources = new Set<string>(["'self'"])
  for (const origin of allowlist.allowedOrigins) {
    sources.add(origin)
  }
  if (allowlist.allowLocalhostWildcardPort) {
    sources.add('http://localhost:*')
    sources.add('ws://localhost:*')
    sources.add('http://127.0.0.1:*')
    sources.add('ws://127.0.0.1:*')
  }

  let directive = `connect-src ${Array.from(sources).join(' ')};`
  if (options.reportUri?.trim()) {
    directive += ` report-uri ${options.reportUri.trim()};`
  }

  return {
    key: options.enforce
      ? 'Content-Security-Policy'
      : 'Content-Security-Policy-Report-Only',
    value: directive,
  }
}

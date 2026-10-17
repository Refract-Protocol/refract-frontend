/**
 * Threat Model — Realtime Origin Validation & Message Authentication
 *
 * Protected against:
 * 1. Cross-origin endpoint hijacking / rogue query-param override pointing the socket
 *    at an untrusted host or plaintext `ws:`/`http:` endpoint in production.
 * 2. Unsigned or tampered frames on security-sensitive topics (`claims:*`, `policies:*`,
 *    `oracle:*`, `pool:*`) injected by an unauthenticated intermediary or spoofed source.
 * 3. Replay of previously captured signed frames outside the replay cache or clock-skew window.
 *
 * Out of scope / Not protected against:
 * - Full compromise of the authoritative backend signing key or session token issuer.
 * - Malicious browser extensions or XSS executing within the same JavaScript realm.
 */

export type AuthRejectionReason =
  | 'disallowed_scheme'
  | 'disallowed_origin'
  | 'missing_signature'
  | 'invalid_signature'
  | 'expired_timestamp'
  | 'future_timestamp_skew'
  | 'replayed_event_id'

export interface EndpointOriginValidationOptions {
  allowedOrigins: string[]
  environment?: 'production' | 'development' | 'test'
  allowInsecureLocalhost?: boolean
}

export interface EndpointOriginValidationResult {
  valid: boolean
  normalizedOrigin?: string
  reason?: AuthRejectionReason
}

export interface SignedRealtimeEnvelope<T = unknown> {
  eventId: string
  topic: string
  timestamp: number
  payload: T
  signature?: string
  sessionNonce?: string
}

export interface AuthBreadcrumb {
  reason: AuthRejectionReason
  topic: string
  eventId?: string
  observedAt: number
}

export interface RealtimeIngressAuthenticatorOptions {
  sessionKey: string
  sessionNonce?: string
  environment?: 'production' | 'development' | 'test'
  /** Only respected when environment !== 'production' */
  allowUnsignedInLocalMock?: boolean
  protectedTopicPrefixes?: string[]
  maxAgeMs?: number
  maxFutureSkewMs?: number
  maxReplayCacheSize?: number
  now?: () => number
  onRejected?: (breadcrumb: AuthBreadcrumb) => void
}

const DEFAULT_PROTECTED_PREFIXES = ['claims:', 'policies:', 'oracle:', 'pool:']

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  return lower === 'localhost' || lower === '127.0.0.1' || lower === '[::1]'
}

/**
 * Validates that a candidate realtime WebSocket/SSE URL uses an allowed scheme
 * and matches the configured origin allow-list.
 */
export function validateRealtimeEndpointOrigin(
  endpointUrl: string,
  options: EndpointOriginValidationOptions,
): EndpointOriginValidationResult {
  let parsed: URL
  try {
    parsed = new URL(endpointUrl)
  } catch {
    return { valid: false, reason: 'disallowed_origin' }
  }

  const env = options.environment ?? 'production'
  const allowLocalInsecure =
    options.allowInsecureLocalhost ?? env !== 'production'
  const protocol = parsed.protocol.toLowerCase()

  const isSecure = protocol === 'wss:' || protocol === 'https:'
  const isInsecureWsOrHttp = protocol === 'ws:' || protocol === 'http:'

  if (!isSecure) {
    if (
      !isInsecureWsOrHttp ||
      env === 'production' ||
      !allowLocalInsecure ||
      !isLoopbackHost(parsed.hostname)
    ) {
      return { valid: false, reason: 'disallowed_scheme' }
    }
  }

  const normalizedCandidate = `${parsed.protocol}//${parsed.host}`.toLowerCase()
  const allowedNormalized = new Set(
    options.allowedOrigins
      .map((origin) => {
        try {
          const u = new URL(origin)
          return `${u.protocol}//${u.host}`.toLowerCase()
        } catch {
          return origin.trim().toLowerCase()
        }
      })
      .filter(Boolean),
  )

  if (!allowedNormalized.has(normalizedCandidate)) {
    return { valid: false, reason: 'disallowed_origin' }
  }

  return {
    valid: true,
    normalizedOrigin: normalizedCandidate,
  }
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${stableSerialize(obj[k])}`,
  )
  return `{${entries.join(',')}}`
}

/**
 * Synchronous, dependency-light keyed FNV-1a 64-bit Pair MAC computation for
 * session-bound message integrity verification in browser and SSR runtimes.
 */
export function computeRealtimeMessageMac(
  sessionKey: string,
  envelope: {
    eventId: string
    topic: string
    timestamp: number
    payload: unknown
    sessionNonce?: string
  },
): string {
  const canonical = [
    envelope.eventId,
    envelope.topic,
    String(envelope.timestamp),
    envelope.sessionNonce ?? '',
    stableSerialize(envelope.payload),
  ].join('|')

  const input = `${sessionKey}::${canonical}::${sessionKey}`
  let h1 = 0x811c9dc5
  let h2 = 0x811c9dc5

  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= code ^ (i & 0xff)
    h2 = Math.imul(h2, 0x01000193)
  }

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0')
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0')
  return `v1:${hex1}${hex2}`
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * Ingress authenticator that verifies message integrity, clock-skew bounds,
 * and replay protection before events reach realtime subscribers.
 */
export class RealtimeIngressAuthenticator {
  private readonly sessionKey: string
  private readonly sessionNonce?: string
  private readonly environment: 'production' | 'development' | 'test'
  private readonly allowUnsignedInLocalMock: boolean
  private readonly protectedPrefixes: string[]
  private readonly maxAgeMs: number
  private readonly maxFutureSkewMs: number
  private readonly maxReplayCacheSize: number
  private readonly now: () => number
  private readonly onRejected?: (breadcrumb: AuthBreadcrumb) => void

  private readonly seenEventIds = new Set<string>()
  private readonly seenOrder: string[] = []
  private readonly rejectionCounts: Record<AuthRejectionReason, number> = {
    disallowed_scheme: 0,
    disallowed_origin: 0,
    missing_signature: 0,
    invalid_signature: 0,
    expired_timestamp: 0,
    future_timestamp_skew: 0,
    replayed_event_id: 0,
  }

  constructor(options: RealtimeIngressAuthenticatorOptions) {
    this.sessionKey = options.sessionKey
    this.sessionNonce = options.sessionNonce
    this.environment = options.environment ?? 'production'
    // Production never allows unsigned bypass even if flag is passed
    this.allowUnsignedInLocalMock =
      this.environment !== 'production' &&
      Boolean(options.allowUnsignedInLocalMock)
    this.protectedPrefixes =
      options.protectedTopicPrefixes ?? DEFAULT_PROTECTED_PREFIXES
    this.maxAgeMs = options.maxAgeMs ?? 60_000
    this.maxFutureSkewMs = options.maxFutureSkewMs ?? 15_000
    this.maxReplayCacheSize = options.maxReplayCacheSize ?? 500
    this.now = options.now ?? (() => Date.now())
    this.onRejected = options.onRejected
  }

  public isTopicProtected(topic: string): boolean {
    const normalized = topic.trim().toLowerCase()
    return this.protectedPrefixes.some((prefix) =>
      normalized.startsWith(prefix.toLowerCase()),
    )
  }

  public verifyEnvelope<T = unknown>(
    envelope: SignedRealtimeEnvelope<T>,
  ): { accepted: boolean; reason?: AuthRejectionReason } {
    const currentTime = this.now()
    const age = currentTime - envelope.timestamp

    if (age > this.maxAgeMs) {
      return this.reject('expired_timestamp', envelope.topic, envelope.eventId)
    }

    if (envelope.timestamp - currentTime > this.maxFutureSkewMs) {
      return this.reject(
        'future_timestamp_skew',
        envelope.topic,
        envelope.eventId,
      )
    }

    if (this.seenEventIds.has(envelope.eventId)) {
      return this.reject('replayed_event_id', envelope.topic, envelope.eventId)
    }

    if (this.isTopicProtected(envelope.topic) && !this.allowUnsignedInLocalMock) {
      if (!envelope.signature) {
        return this.reject(
          'missing_signature',
          envelope.topic,
          envelope.eventId,
        )
      }

      const expectedSignature = computeRealtimeMessageMac(this.sessionKey, {
        eventId: envelope.eventId,
        topic: envelope.topic,
        timestamp: envelope.timestamp,
        payload: envelope.payload,
        sessionNonce: envelope.sessionNonce ?? this.sessionNonce,
      })

      if (!constantTimeEquals(envelope.signature, expectedSignature)) {
        return this.reject(
          'invalid_signature',
          envelope.topic,
          envelope.eventId,
        )
      }
    }

    this.recordSeenEventId(envelope.eventId)
    return { accepted: true }
  }

  public getRejectionCounts(): Record<AuthRejectionReason, number> {
    return { ...this.rejectionCounts }
  }

  private reject(
    reason: AuthRejectionReason,
    topic: string,
    eventId?: string,
  ): { accepted: boolean; reason: AuthRejectionReason } {
    this.rejectionCounts[reason] += 1
    this.onRejected?.({
      reason,
      topic,
      eventId,
      observedAt: this.now(),
    })
    return { accepted: false, reason }
  }

  private recordSeenEventId(eventId: string): void {
    this.seenEventIds.add(eventId)
    this.seenOrder.push(eventId)
    while (this.seenOrder.length > this.maxReplayCacheSize) {
      const oldest = this.seenOrder.shift()
      if (oldest !== undefined) {
        this.seenEventIds.delete(oldest)
      }
    }
  }
}

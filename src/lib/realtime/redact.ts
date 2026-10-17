/**
 * PII redaction, payload sanitization, and level-gated diagnostic logger for
 * the realtime layer (#282).
 *
 * Ensures wallet addresses, session/auth tokens, signed XDR payloads, and raw
 * frames are scrubbed or truncated before reaching console logs, breadcrumbs,
 * error reports, or telemetry sinks.
 */

const STELLAR_KEY_PATTERN = /\b[GSC][A-Z2-7]{55}\b/g
const JWT_TOKEN_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi

const REDACTED_SECRET_KEYS = new Set([
  'token',
  'authtoken',
  'accesstoken',
  'refreshtoken',
  'auth',
  'authorization',
  'signature',
  'secret',
  'privatekey',
  'signedxdr',
  'xdr',
  'cookie',
  'sessionid',
])

const REDACTED_ADDRESS_KEYS = new Set([
  'wallet',
  'walletaddress',
  'address',
  'holder',
  'claimant',
  'account',
  'publickey',
])

const PRESERVED_DIAGNOSTIC_KEYS = new Set([
  'type',
  'eventid',
  'sequence',
  'seq',
  'bytelength',
  'code',
  'status',
  'timestamp',
  'retryable',
])

export interface RedactionOptions {
  /** Maximum character length for arbitrary non-preserved strings before truncation (default: 120). */
  maxStringLength?: number
  /** Maximum object nesting depth before summarizing as `[MaxDepth]` (default: 5). */
  maxDepth?: number
}

/**
 * Scrubs Stellar addresses, JWTs, and Bearer tokens inside a string and
 * truncates oversized strings while preserving diagnostic prefixes.
 */
export function redactStringPatterns(
  input: string,
  maxStringLength = 120
): string {
  // Guard against running regexes over huge strings by slicing first if enormous
  const boundedInput =
    input.length > 4_096 ? `${input.slice(0, 4_096)}...[TRUNCATED]` : input

  const scrubbed = boundedInput
    .replace(STELLAR_KEY_PATTERN, (addr) => {
      return `${addr.slice(0, 4)}...${addr.slice(-4)}[REDACTED]`
    })
    .replace(JWT_TOKEN_PATTERN, '[REDACTED_JWT]')
    .replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED_TOKEN]')

  if (scrubbed.length > maxStringLength) {
    return `${scrubbed.slice(0, maxStringLength)}...[TRUNCATED:${scrubbed.length}]`
  }
  return scrubbed
}

/**
 * Recursively sanitizes any value (primitives, plain objects, arrays, and `Error`
 * instances) for safe logging or error reporting.
 */
export function sanitizeRealtimeDiagnosticValue(
  value: unknown,
  options: RedactionOptions = {},
  currentDepth = 0
): unknown {
  const maxStringLength = options.maxStringLength ?? 120
  const maxDepth = options.maxDepth ?? 5

  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return redactStringPatterns(value, maxStringLength)
  }

  if (value instanceof Error) {
    const sanitizedError: Record<string, unknown> = {
      name: value.name,
      message: redactStringPatterns(value.message, maxStringLength),
    }
    const extraEntries = Object.entries(
      value as unknown as Record<string, unknown>
    )
    for (const [k, v] of extraEntries) {
      if (k === 'stack') continue
      sanitizedError[k] = sanitizeObjectProperty(
        k,
        v,
        options,
        currentDepth + 1
      )
    }
    return sanitizedError
  }

  if (currentDepth >= maxDepth) {
    return '[MaxDepth]'
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeRealtimeDiagnosticValue(item, options, currentDepth + 1)
    )
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, propVal] of Object.entries(
      value as Record<string, unknown>
    )) {
      out[key] = sanitizeObjectProperty(key, propVal, options, currentDepth + 1)
    }
    return out
  }

  return String(value)
}

function sanitizeObjectProperty(
  key: string,
  propVal: unknown,
  options: RedactionOptions,
  nextDepth: number
): unknown {
  const normalizedKey = key.replace(/[_-]/g, '').toLowerCase()

  if (REDACTED_SECRET_KEYS.has(normalizedKey)) {
    return '[REDACTED_SECRET]'
  }

  if (REDACTED_ADDRESS_KEYS.has(normalizedKey)) {
    if (typeof propVal === 'string' && propVal.length >= 12) {
      return `${propVal.slice(0, 4)}...${propVal.slice(-4)}[REDACTED]`
    }
    return '[REDACTED_ADDRESS]'
  }

  if (normalizedKey === 'rawframe' || normalizedKey === 'rawpayload') {
    const byteLength =
      typeof propVal === 'string'
        ? propVal.length
        : propVal instanceof Uint8Array
          ? propVal.byteLength
          : undefined
    return byteLength !== undefined
      ? `[REDACTED_FRAME:${byteLength}B]`
      : '[REDACTED_FRAME]'
  }

  if (
    PRESERVED_DIAGNOSTIC_KEYS.has(normalizedKey) &&
    (typeof propVal === 'number' || typeof propVal === 'boolean')
  ) {
    return propVal
  }

  return sanitizeRealtimeDiagnosticValue(propVal, options, nextDepth)
}

/**
 * Projects a raw wire frame into a safe, non-PII diagnostic summary.
 */
export function summarizeFrameForDiagnostics(frame: {
  topic?: string
  type?: string
  sequence?: number
  eventId?: string
  rawByteLength?: number
}): Record<string, unknown> {
  return {
    type: frame.type ?? 'unknown',
    topic: frame.topic ? redactStringPatterns(frame.topic, 80) : undefined,
    sequence: frame.sequence,
    eventId: frame.eventId,
    byteLength: frame.rawByteLength,
  }
}

export type RealtimeLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LOG_LEVEL_WEIGHT: Record<RealtimeLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
}

export interface SanitizedLoggerSink {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export interface SanitizedRealtimeLoggerOptions extends RedactionOptions {
  /** Whether running in production (defaults to `'warn'` minimum level in production, `'info'` in dev). */
  isProduction?: boolean
  /** Explicit minimum log level override. */
  minLevel?: RealtimeLogLevel
  /** Underlying log sink (defaults to `console`). */
  sink?: SanitizedLoggerSink
}

export class SanitizedRealtimeLogger {
  private readonly sink: SanitizedLoggerSink
  private readonly redactionOptions: RedactionOptions
  private readonly baseMinLevel: RealtimeLogLevel
  private verboseDebugEnabled = false

  constructor(options: SanitizedRealtimeLoggerOptions = {}) {
    const isProd =
      options.isProduction ??
      (typeof process !== 'undefined' &&
        process.env?.NODE_ENV === 'production')
    this.baseMinLevel = options.minLevel ?? (isProd ? 'warn' : 'info')
    this.sink = options.sink ?? console
    this.redactionOptions = {
      maxStringLength: options.maxStringLength,
      maxDepth: options.maxDepth,
    }
  }

  /**
   * Non-persistent runtime switch allowing developers to temporarily enable
   * verbose `debug`/`info` logging during live troubleshooting.
   */
  setVerboseDebug(enabled: boolean): void {
    this.verboseDebugEnabled = enabled
  }

  isVerboseDebugEnabled(): boolean {
    return this.verboseDebugEnabled
  }

  debug(...args: unknown[]): void {
    this.emit('debug', args)
  }

  info(...args: unknown[]): void {
    this.emit('info', args)
  }

  warn(...args: unknown[]): void {
    this.emit('warn', args)
  }

  error(...args: unknown[]): void {
    this.emit('error', args)
  }

  private emit(level: Exclude<RealtimeLogLevel, 'silent'>, args: unknown[]): void {
    const effectiveMin: RealtimeLogLevel = this.verboseDebugEnabled
      ? 'debug'
      : this.baseMinLevel

    if (LOG_LEVEL_WEIGHT[level] < LOG_LEVEL_WEIGHT[effectiveMin]) {
      return
    }

    const sanitizedArgs = args.map((arg) =>
      sanitizeRealtimeDiagnosticValue(arg, this.redactionOptions)
    )
    this.sink[level](...sanitizedArgs)
  }
}

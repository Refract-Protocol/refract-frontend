/**
 * Developer and QA override resolver for realtime flags, transport pinning,
 * and mock/staging endpoint selection (#279).
 *
 * Precedence chain (highest to lowest):
 * 1. Remote Kill Switch (always wins in production builds)
 * 2. Developer/QA Override (`?realtime=off|ws|sse|longpoll|mock`, gated to dev / allowlisted QA hosts)
 * 3. Environment & Feature Flag Configuration
 * 4. Built-in Safe Defaults (`enabled: false`, `transport: 'rest'`)
 */

export type RealtimeOverrideMode = 'off' | 'ws' | 'sse' | 'longpoll' | 'mock'

export const QA_OVERRIDE_SESSION_KEY = 'refract:qa:realtime_override:v1'

export interface RealtimeOverrideSpec {
  mode?: RealtimeOverrideMode
  endpoint?: string
}

export interface ResolvedRealtimeConfig {
  enabled: boolean
  transport: 'ws' | 'sse' | 'longpoll' | 'mock' | 'rest'
  endpoint: string
  source: 'kill_switch' | 'qa_override' | 'env_config' | 'default'
  isOverridden: boolean
  /** Visible badge label for the UI status indicator when a QA override is active. */
  overrideBadgeLabel: string | null
  /** False when a QA override is active so override sessions never pollute production telemetry. */
  includeInTelemetry: boolean
}

export interface SessionStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface RealtimeOverrideResolverOptions {
  /** Whether the build is running in production mode. */
  isProduction?: boolean
  /** Current hostname (e.g. `window.location.hostname`) used to check QA host allowlist in production builds. */
  hostname?: string
  /** Hostnames permitted to use QA overrides even in production builds (default: `localhost`, `127.0.0.1`, `staging.refract.finance`). */
  allowedQaHosts?: readonly string[]
  /** Default endpoint from environment when not overridden. */
  defaultEndpoint?: string
  /** Default mock server endpoint when `?realtime=mock` is used (default: `ws://localhost:4010/realtime`). */
  mockEndpoint?: string
  /** Optional sessionStorage adapter (never uses localStorage). */
  sessionStorage?: SessionStorageLike | null
  /** Invoked when a runtime override changes the active transport or endpoint so the previous socket can tear down cleanly. */
  onTransportChanged?: (
    previous: ResolvedRealtimeConfig | null,
    next: ResolvedRealtimeConfig
  ) => void
}

const VALID_OVERRIDE_MODES = new Set<RealtimeOverrideMode>([
  'off',
  'ws',
  'sse',
  'longpoll',
  'mock',
])

const DEFAULT_ALLOWED_QA_HOSTS = [
  'localhost',
  '127.0.0.1',
  'staging.refract.finance',
]

/**
 * Parses `?realtime=off|ws|sse|longpoll|mock` and `?realtimeEndpoint=...` from a URL search string.
 */
export function parseRealtimeOverrideFromQuery(
  search: string
): RealtimeOverrideSpec | null {
  const trimmed = search.trim()
  if (!trimmed) return null

  const params = new URLSearchParams(
    trimmed.startsWith('?') ? trimmed.slice(1) : trimmed
  )
  const rawMode = params.get('realtime')?.trim().toLowerCase() as
    | RealtimeOverrideMode
    | undefined
  const rawEndpoint = params.get('realtimeEndpoint')?.trim()

  const mode =
    rawMode && VALID_OVERRIDE_MODES.has(rawMode) ? rawMode : undefined
  const endpoint =
    rawEndpoint && isAllowedOverrideEndpoint(rawEndpoint)
      ? rawEndpoint
      : undefined

  if (!mode && !endpoint) {
    return null
  }
  return { mode, endpoint }
}

function isAllowedOverrideEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'ws:' ||
      parsed.protocol === 'wss:' ||
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:'
    )
  } catch {
    return false
  }
}

export class RealtimeOverrideResolver {
  private readonly isProduction: boolean
  private readonly hostname: string
  private readonly allowedQaHosts: ReadonlySet<string>
  private readonly defaultEndpoint: string
  private readonly mockEndpoint: string
  private readonly storage: SessionStorageLike | null
  private readonly onTransportChanged?: (
    previous: ResolvedRealtimeConfig | null,
    next: ResolvedRealtimeConfig
  ) => void

  private runtimeOverride: RealtimeOverrideSpec | null = null
  private lastResolved: ResolvedRealtimeConfig | null = null

  constructor(options: RealtimeOverrideResolverOptions = {}) {
    this.isProduction =
      options.isProduction ??
      (typeof process !== 'undefined' &&
        process.env?.NODE_ENV === 'production')
    this.hostname =
      options.hostname ??
      (typeof window !== 'undefined' && window.location
        ? window.location.hostname
        : 'localhost')
    this.allowedQaHosts = new Set(
      (options.allowedQaHosts ?? DEFAULT_ALLOWED_QA_HOSTS).map((h) =>
        h.toLowerCase()
      )
    )
    this.defaultEndpoint =
      options.defaultEndpoint ?? 'wss://api.refract.finance/realtime'
    this.mockEndpoint =
      options.mockEndpoint ?? 'ws://localhost:4010/realtime'
    this.storage =
      options.sessionStorage !== undefined
        ? options.sessionStorage
        : typeof window !== 'undefined' && window.sessionStorage
          ? window.sessionStorage
          : null
    this.onTransportChanged = options.onTransportChanged

    this.loadFromSessionStorage()
  }

  /**
   * Returns true if developer/QA overrides are permitted in the current environment/host.
   */
  areOverridesPermitted(): boolean {
    if (!this.isProduction) {
      return true
    }
    const host = this.hostname.toLowerCase()
    if (this.allowedQaHosts.has(host) || host.endsWith('.vercel.app')) {
      return true
    }
    return false
  }

  /**
   * Applies an override parsed from a URL query string or dev panel control.
   */
  applyOverride(spec: RealtimeOverrideSpec): void {
    if (!this.areOverridesPermitted()) {
      return
    }
    this.runtimeOverride = { ...spec }
    if (this.storage) {
      try {
        this.storage.setItem(QA_OVERRIDE_SESSION_KEY, JSON.stringify(spec))
      } catch {
        // Ignore sessionStorage errors
      }
    }
  }

  /**
   * Clears any active or session-persisted QA override and restores default resolution.
   */
  resetToDefaults(): void {
    this.runtimeOverride = null
    if (this.storage) {
      try {
        this.storage.removeItem(QA_OVERRIDE_SESSION_KEY)
      } catch {
        // Ignore sessionStorage errors
      }
    }
  }

  /**
   * Resolves the effective realtime configuration through the strict precedence chain:
   * `remoteKillSwitch` -> `qaOverride` (if permitted) -> `envConfig` -> `default`.
   */
  resolve(input: {
    killSwitchTripped?: boolean
    envEnabled?: boolean
    envTransport?: 'ws' | 'sse' | 'longpoll'
    envEndpoint?: string
    querySearch?: string
  } = {}): ResolvedRealtimeConfig {
    // If querySearch is passed on load, apply it if permitted
    if (input.querySearch) {
      const fromQuery = parseRealtimeOverrideFromQuery(input.querySearch)
      if (fromQuery) {
        this.applyOverride(fromQuery)
      }
    }

    const baseEndpoint = input.envEndpoint ?? this.defaultEndpoint

    // 1. Remote Kill Switch ALWAYS wins in production builds (and in dev unless explicitly overridden)
    const activeOverride = this.areOverridesPermitted()
      ? this.runtimeOverride
      : null

    if (
      input.killSwitchTripped &&
      (this.isProduction || !activeOverride || activeOverride.mode === 'off')
    ) {
      return this.commitAndNotify({
        enabled: false,
        transport: 'rest',
        endpoint: baseEndpoint,
        source: 'kill_switch',
        isOverridden: false,
        overrideBadgeLabel: null,
        includeInTelemetry: true,
      })
    }

    // 2. Developer / QA Override (when permitted)
    if (activeOverride && (activeOverride.mode || activeOverride.endpoint)) {
      const mode = activeOverride.mode ?? (input.envTransport ?? 'ws')
      if (mode === 'off') {
        return this.commitAndNotify({
          enabled: false,
          transport: 'rest',
          endpoint: activeOverride.endpoint ?? baseEndpoint,
          source: 'qa_override',
          isOverridden: true,
          overrideBadgeLabel: 'QA Override: OFF (REST)',
          includeInTelemetry: false,
        })
      }

      const resolvedEndpoint =
        activeOverride.endpoint ??
        (mode === 'mock' ? this.mockEndpoint : baseEndpoint)

      return this.commitAndNotify({
        enabled: true,
        transport: mode,
        endpoint: resolvedEndpoint,
        source: 'qa_override',
        isOverridden: true,
        overrideBadgeLabel: `QA Override: ${mode.toUpperCase()}`,
        includeInTelemetry: false,
      })
    }

    // 3. Environment / Flags Configuration
    if (input.envEnabled !== undefined) {
      return this.commitAndNotify({
        enabled: input.envEnabled,
        transport: input.envEnabled ? (input.envTransport ?? 'ws') : 'rest',
        endpoint: baseEndpoint,
        source: 'env_config',
        isOverridden: false,
        overrideBadgeLabel: null,
        includeInTelemetry: true,
      })
    }

    // 4. Built-in Safe Defaults (`realtimeEnabled: false`)
    return this.commitAndNotify({
      enabled: false,
      transport: 'rest',
      endpoint: baseEndpoint,
      source: 'default',
      isOverridden: false,
      overrideBadgeLabel: null,
      includeInTelemetry: true,
    })
  }

  private commitAndNotify(next: ResolvedRealtimeConfig): ResolvedRealtimeConfig {
    const prev = this.lastResolved
    this.lastResolved = next
    if (
      prev &&
      (prev.transport !== next.transport ||
        prev.endpoint !== next.endpoint ||
        prev.enabled !== next.enabled)
    ) {
      this.onTransportChanged?.(prev, next)
    }
    return next
  }

  private loadFromSessionStorage(): void {
    if (!this.storage || !this.areOverridesPermitted()) return
    try {
      const raw = this.storage.getItem(QA_OVERRIDE_SESSION_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<RealtimeOverrideSpec>
      if (typeof parsed === 'object' && parsed !== null) {
        const mode =
          parsed.mode && VALID_OVERRIDE_MODES.has(parsed.mode)
            ? parsed.mode
            : undefined
        const endpoint =
          typeof parsed.endpoint === 'string' &&
          isAllowedOverrideEndpoint(parsed.endpoint)
            ? parsed.endpoint
            : undefined
        if (mode || endpoint) {
          this.runtimeOverride = { mode, endpoint }
        }
      }
    } catch {
      // Ignore corrupted sessionStorage
    }
  }
}

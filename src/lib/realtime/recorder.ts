/**
 * Opt-in event recording and deterministic replay harness for reproducing
 * realtime incidents (#236).
 *
 * Captures ordered inbound/outbound frames and connection lifecycle events
 * in a bounded ring buffer, redacts Stellar wallet addresses and signatures
 * by default on export, and replays captured sessions deterministically.
 */

export type RecordedRecordKind = 'frame_in' | 'frame_out' | 'lifecycle'

export type RecordedLifecycleState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'fallback'
  | 'error'

export interface RecordedSessionEntry {
  /** Monotonic sequence index within the recording session. */
  index: number
  /** Milliseconds elapsed since recording started (`0` for the first event). */
  offsetMs: number
  /** Original epoch timestamp when the entry was recorded. */
  timestamp: number
  /** Category of recorded event. */
  kind: RecordedRecordKind
  /** Topic identifier when applicable. */
  topic?: string
  /** Lifecycle transition state when `kind === 'lifecycle'`. */
  lifecycleState?: RecordedLifecycleState
  /** Raw or structured frame payload / lifecycle metadata. */
  payload?: unknown
}

export interface RealtimeRecordingBundle {
  version: 1
  sessionId: string
  createdAt: number
  redacted: boolean
  droppedEntries: number
  entries: RecordedSessionEntry[]
}

export interface RealtimeRecorderOptions {
  /** Maximum entries retained in the ring buffer (default: 1,000). */
  maxEntries?: number
  /** Whether recording is enabled initially (default: false — opt-in). */
  enabled?: boolean
  /** Session identifier (default: generated timestamp id). */
  sessionId?: string
  /** Clock provider for deterministic testing. */
  nowFn?: () => number
}

export interface ExportRecordingOptions {
  /**
   * Explicitly opt in to include raw wallet addresses, tokens, and signatures
   * without redaction (default: false).
   */
  includeSensitive?: boolean
}

const STELLAR_ADDRESS_PATTERN = /\b[GSC][A-Z2-7]{55}\b/g
const SENSITIVE_KEY_PATTERN = /(signature|secret|token|authorization|privateKey)/i

/**
 * Recursively clones and redacts Stellar wallet/contract addresses (`G...`, `S...`, `C...`)
 * and sensitive credential fields (`signature`, `token`, `secret`, `authorization`).
 */
export function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(STELLAR_ADDRESS_PATTERN, (match) => {
      return `${match.slice(0, 4)}...${match.slice(-4)}[REDACTED]`
    })
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item))
  }
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key) && typeof val === 'string') {
        output[key] = '[REDACTED_SECRET]'
      } else {
        output[key] = redactSensitiveValue(val)
      }
    }
    return output
  }
  return value
}

export class RealtimeSessionRecorder {
  private readonly maxEntries: number
  private readonly nowFn: () => number
  private readonly sessionId: string
  private enabled: boolean
  private startedAt: number | null = null
  private nextIndex = 1
  private droppedEntries = 0
  private buffer: RecordedSessionEntry[] = []

  constructor(options: RealtimeRecorderOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 1_000)
    this.enabled = options.enabled ?? false
    this.nowFn = options.nowFn ?? (() => Date.now())
    this.sessionId = options.sessionId ?? `rt-rec-${this.nowFn()}`
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (enabled && this.startedAt === null) {
      this.startedAt = this.nowFn()
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Pass-through observer for inbound frames. Never throws into the hot path.
   */
  recordInboundFrame(topic: string | undefined, payload: unknown): void {
    this.appendEntry({
      kind: 'frame_in',
      topic,
      payload,
    })
  }

  /**
   * Pass-through observer for outbound frames. Never throws into the hot path.
   */
  recordOutboundFrame(topic: string | undefined, payload: unknown): void {
    this.appendEntry({
      kind: 'frame_out',
      topic,
      payload,
    })
  }

  /**
   * Records a connection lifecycle transition.
   */
  recordLifecycle(state: RecordedLifecycleState, metadata?: unknown): void {
    this.appendEntry({
      kind: 'lifecycle',
      lifecycleState: state,
      payload: metadata,
    })
  }

  /**
   * Exports a serializable recording bundle with PII redacted by default.
   */
  exportBundle(options: ExportRecordingOptions = {}): RealtimeRecordingBundle {
    const includeSensitive = options.includeSensitive === true
    const exportedEntries: RecordedSessionEntry[] = this.buffer.map((entry) => {
      if (includeSensitive) {
        return { ...entry }
      }
      return {
        ...entry,
        topic: entry.topic ? (redactSensitiveValue(entry.topic) as string) : undefined,
        payload: redactSensitiveValue(entry.payload),
      }
    })

    return {
      version: 1,
      sessionId: this.sessionId,
      createdAt: this.startedAt ?? this.nowFn(),
      redacted: !includeSensitive,
      droppedEntries: this.droppedEntries,
      entries: exportedEntries,
    }
  }

  clear(): void {
    this.buffer = []
    this.droppedEntries = 0
    this.nextIndex = 1
    this.startedAt = null
  }

  getSize(): number {
    return this.buffer.length
  }

  private appendEntry(
    partial: Pick<RecordedSessionEntry, 'kind' | 'topic' | 'lifecycleState' | 'payload'>
  ): void {
    if (!this.enabled) return
    try {
      const now = this.nowFn()
      if (this.startedAt === null) {
        this.startedAt = now
      }
      if (this.buffer.length >= this.maxEntries) {
        this.buffer.shift()
        this.droppedEntries += 1
      }
      this.buffer.push({
        index: this.nextIndex++,
        offsetMs: Math.max(0, now - this.startedAt),
        timestamp: now,
        ...partial,
      })
    } catch {
      // Never block or throw into the realtime message hot path
    }
  }
}

export interface ReplayHandlers {
  onInboundFrame?: (entry: RecordedSessionEntry) => void
  onOutboundFrame?: (entry: RecordedSessionEntry) => void
  onLifecycle?: (entry: RecordedSessionEntry) => void
}

export interface ReplayHarnessOptions {
  /**
   * Playback speed multiplier (`1` = original relative timing, `2` = 2x faster,
   * `Infinity` or `0` = immediate synchronous/stepped playback without timers).
   */
  speedMultiplier?: number
}

/**
 * Deterministic replay harness that drives a captured `RealtimeRecordingBundle`
 * through consumer callbacks in stepped, instant, or timed mode.
 */
export class RealtimeReplayHarness {
  private readonly entries: readonly RecordedSessionEntry[]
  private readonly handlers: ReplayHandlers
  private cursor = 0

  constructor(bundle: RealtimeRecordingBundle, handlers: ReplayHandlers) {
    this.entries = bundle.entries
    this.handlers = handlers
  }

  /**
   * Steps forward by a single recorded entry. Returns the dispatched entry or `null` if finished.
   */
  stepNext(): RecordedSessionEntry | null {
    if (this.cursor >= this.entries.length) {
      return null
    }
    const entry = this.entries[this.cursor++]
    this.dispatch(entry)
    return entry
  }

  /**
   * Synchronously replays all remaining entries in exact recorded order.
   */
  playAllInstant(): number {
    let count = 0
    while (this.stepNext() !== null) {
      count += 1
    }
    return count
  }

  /**
   * Replays all remaining entries respecting relative `offsetMs` intervals scaled by `speedMultiplier`.
   */
  async playWithTiming(options: ReplayHarnessOptions = {}): Promise<number> {
    const speed = options.speedMultiplier ?? 1
    if (!Number.isFinite(speed) || speed <= 0) {
      return this.playAllInstant()
    }

    let count = 0
    let prevOffsetMs =
      this.cursor > 0 ? this.entries[this.cursor - 1].offsetMs : 0

    while (this.cursor < this.entries.length) {
      const nextEntry = this.entries[this.cursor]
      const deltaMs = Math.max(0, nextEntry.offsetMs - prevOffsetMs)
      const waitMs = Math.round(deltaMs / speed)
      if (waitMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs))
      }
      prevOffsetMs = nextEntry.offsetMs
      this.stepNext()
      count += 1
    }
    return count
  }

  reset(): void {
    this.cursor = 0
  }

  getRemainingCount(): number {
    return Math.max(0, this.entries.length - this.cursor)
  }

  private dispatch(entry: RecordedSessionEntry): void {
    if (entry.kind === 'frame_in') {
      this.handlers.onInboundFrame?.(entry)
    } else if (entry.kind === 'frame_out') {
      this.handlers.onOutboundFrame?.(entry)
    } else if (entry.kind === 'lifecycle') {
      this.handlers.onLifecycle?.(entry)
    }
  }
}

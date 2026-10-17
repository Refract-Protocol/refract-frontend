/**
 * Client-side bandwidth and data-usage meter for the realtime connection (#289).
 *
 * Tracks inbound/outbound decoded wire payload byte counts per topic, current
 * connection totals, cumulative session totals, and coarse bytes-per-hour rates.
 *
 * Accounting note:
 * - `bytesIn` and `bytesOut` measure exact UTF-8 or binary payload bytes at the
 *   JavaScript WebSocket/SSE/Long-Poll boundary (post-TLS/permessage-deflate
 *   decompression).
 * - `estimatedFramingOverheadBytes` separately tracks the ~6-byte WebSocket
 *   frame header overhead per message so diagnostics can distinguish payload
 *   bytes from protocol framing.
 */

const WS_FRAME_HEADER_OVERHEAD_BYTES = 6

export interface TopicBandwidthStats {
  topic: string
  bytesIn: number
  bytesOut: number
  messagesIn: number
  messagesOut: number
  avgBytesIn: number
  avgBytesOut: number
}

export interface BandwidthMeterSnapshot {
  sessionStartedAt: number
  elapsedMs: number
  /** Cumulative session inbound payload bytes (survives reconnects). */
  sessionBytesIn: number
  /** Cumulative session outbound payload bytes (survives reconnects). */
  sessionBytesOut: number
  sessionMessagesIn: number
  sessionMessagesOut: number
  /** Estimated WebSocket framing header overhead bytes (~6B per frame). */
  estimatedFramingOverheadBytes: number
  /** Inbound payload bytes since the most recent connection/reconnect. */
  currentConnectionBytesIn: number
  /** Outbound payload bytes since the most recent connection/reconnect. */
  currentConnectionBytesOut: number
  reconnectCount: number
  /** Coarse extrapolated hourly data rate (bytes/hour) based on session elapsed time. */
  estimatedBytesPerHour: number
  perTopic: Record<string, TopicBandwidthStats>
}

export interface BandwidthMeterOptions {
  /** Minimum interval in ms between UI subscriber notifications to prevent re-render storms (default: 1,000ms). */
  uiSampleIntervalMs?: number
  /** Clock provider for deterministic testing. */
  nowFn?: () => number
}

/**
 * Computes exact byte length of a string, `Uint8Array`, or `ArrayBuffer` frame
 * without retaining a reference to the payload.
 */
export function computeWireByteLength(
  frame: string | Uint8Array | ArrayBuffer
): number {
  if (typeof frame === 'string') {
    // Fast UTF-8 byte length calculation without allocating a Uint8Array buffer
    let bytes = 0
    for (let i = 0; i < frame.length; i++) {
      const code = frame.charCodeAt(i)
      if (code < 0x80) {
        bytes += 1
      } else if (code < 0x800) {
        bytes += 2
      } else if (code >= 0xd800 && code <= 0xdbff) {
        // Surrogate pair = 4 bytes in UTF-8
        bytes += 4
        i += 1
      } else {
        bytes += 3
      }
    }
    return bytes
  }
  if (frame instanceof ArrayBuffer) {
    return frame.byteLength
  }
  return frame.byteLength
}

interface MutableTopicCounters {
  bytesIn: number
  bytesOut: number
  messagesIn: number
  messagesOut: number
}

export class RealtimeBandwidthMeter {
  private readonly uiSampleIntervalMs: number
  private readonly nowFn: () => number
  private sessionStartedAt: number

  private sessionBytesIn = 0
  private sessionBytesOut = 0
  private sessionMessagesIn = 0
  private sessionMessagesOut = 0
  private estimatedFramingOverheadBytes = 0
  private currentConnectionBytesIn = 0
  private currentConnectionBytesOut = 0
  private reconnectCount = 0

  private readonly topicCounters = new Map<string, MutableTopicCounters>()
  private readonly listeners = new Set<(snapshot: BandwidthMeterSnapshot) => void>()
  private notifyTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: BandwidthMeterOptions = {}) {
    this.uiSampleIntervalMs = Math.max(0, options.uiSampleIntervalMs ?? 1_000)
    this.nowFn = options.nowFn ?? (() => Date.now())
    this.sessionStartedAt = this.nowFn()
  }

  /**
   * Records an inbound wire frame for `topic`.
   */
  recordInbound(
    topic: string,
    frameOrBytes: string | Uint8Array | ArrayBuffer | number
  ): void {
    const bytes =
      typeof frameOrBytes === 'number'
        ? Math.max(0, frameOrBytes)
        : computeWireByteLength(frameOrBytes)

    this.sessionBytesIn += bytes
    this.currentConnectionBytesIn += bytes
    this.sessionMessagesIn += 1
    this.estimatedFramingOverheadBytes += WS_FRAME_HEADER_OVERHEAD_BYTES

    const counter = this.getOrCreateTopicCounter(topic)
    counter.bytesIn += bytes
    counter.messagesIn += 1

    this.scheduleNotification()
  }

  /**
   * Records an outbound wire frame for `topic` (or `'control'` when connection-wide).
   */
  recordOutbound(
    topic: string,
    frameOrBytes: string | Uint8Array | ArrayBuffer | number
  ): void {
    const bytes =
      typeof frameOrBytes === 'number'
        ? Math.max(0, frameOrBytes)
        : computeWireByteLength(frameOrBytes)

    this.sessionBytesOut += bytes
    this.currentConnectionBytesOut += bytes
    this.sessionMessagesOut += 1
    this.estimatedFramingOverheadBytes += WS_FRAME_HEADER_OVERHEAD_BYTES

    const counter = this.getOrCreateTopicCounter(topic)
    counter.bytesOut += bytes
    counter.messagesOut += 1

    this.scheduleNotification()
  }

  /**
   * Resets per-connection counters on reconnect while preserving cumulative
   * session totals and per-topic totals.
   */
  markReconnect(): void {
    this.reconnectCount += 1
    this.currentConnectionBytesIn = 0
    this.currentConnectionBytesOut = 0
    this.scheduleNotification()
  }

  /**
   * Resets all cumulative session and per-topic counters.
   */
  resetSession(): void {
    this.sessionStartedAt = this.nowFn()
    this.sessionBytesIn = 0
    this.sessionBytesOut = 0
    this.sessionMessagesIn = 0
    this.sessionMessagesOut = 0
    this.estimatedFramingOverheadBytes = 0
    this.currentConnectionBytesIn = 0
    this.currentConnectionBytesOut = 0
    this.reconnectCount = 0
    this.topicCounters.clear()
    this.scheduleNotification()
  }

  /**
   * Returns a point-in-time snapshot of bandwidth and message metrics.
   */
  getSnapshot(): BandwidthMeterSnapshot {
    const now = this.nowFn()
    const elapsedMs = Math.max(0, now - this.sessionStartedAt)
    const totalBytes = this.sessionBytesIn + this.sessionBytesOut
    // Extrapolate hourly rate using a minimum 1,000ms denominator to avoid division spikes at t=0
    const effectiveWindowMs = Math.max(1_000, elapsedMs)
    const estimatedBytesPerHour = Math.round(
      (totalBytes / effectiveWindowMs) * 3_600_000
    )

    const perTopic: Record<string, TopicBandwidthStats> = {}
    for (const [topic, c] of this.topicCounters.entries()) {
      perTopic[topic] = {
        topic,
        bytesIn: c.bytesIn,
        bytesOut: c.bytesOut,
        messagesIn: c.messagesIn,
        messagesOut: c.messagesOut,
        avgBytesIn: c.messagesIn > 0 ? Math.round(c.bytesIn / c.messagesIn) : 0,
        avgBytesOut:
          c.messagesOut > 0 ? Math.round(c.bytesOut / c.messagesOut) : 0,
      }
    }

    return {
      sessionStartedAt: this.sessionStartedAt,
      elapsedMs,
      sessionBytesIn: this.sessionBytesIn,
      sessionBytesOut: this.sessionBytesOut,
      sessionMessagesIn: this.sessionMessagesIn,
      sessionMessagesOut: this.sessionMessagesOut,
      estimatedFramingOverheadBytes: this.estimatedFramingOverheadBytes,
      currentConnectionBytesIn: this.currentConnectionBytesIn,
      currentConnectionBytesOut: this.currentConnectionBytesOut,
      reconnectCount: this.reconnectCount,
      estimatedBytesPerHour,
      perTopic,
    }
  }

  /**
   * Subscribes to throttled UI snapshot updates.
   */
  subscribe(listener: (snapshot: BandwidthMeterSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.notifyTimer !== null) {
        clearTimeout(this.notifyTimer)
        this.notifyTimer = null
      }
    }
  }

  private getOrCreateTopicCounter(topic: string): MutableTopicCounters {
    const key = topic.trim() || 'control'
    let existing = this.topicCounters.get(key)
    if (!existing) {
      existing = {
        bytesIn: 0,
        bytesOut: 0,
        messagesIn: 0,
        messagesOut: 0,
      }
      this.topicCounters.set(key, existing)
    }
    return existing
  }

  private scheduleNotification(): void {
    if (this.listeners.size === 0) return
    if (this.uiSampleIntervalMs === 0) {
      this.flushListeners()
      return
    }
    if (this.notifyTimer !== null) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      this.flushListeners()
    }, this.uiSampleIntervalMs)
  }

  private flushListeners(): void {
    if (this.listeners.size === 0) return
    const snapshot = this.getSnapshot()
    for (const listener of Array.from(this.listeners)) {
      listener(snapshot)
    }
  }
}

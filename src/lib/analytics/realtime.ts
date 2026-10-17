export type RealtimeProductEventName =
  | 'realtime.connection_established'
  | 'realtime.fallback_activated'
  | 'realtime.fallback_deactivated'
  | 'realtime.topic_subscribed'
  | 'realtime.topic_unsubscribed'
  | 'realtime.subscription_failed'
  | 'realtime.unavailable'

export type RealtimeAnalyticsTransportKind =
  | 'websocket'
  | 'sse'
  | 'polling'
  | 'soroban_rpc'
  | 'none'

export interface RealtimeProductEventDimensions {
  transport: RealtimeAnalyticsTransportKind
  topicFamily?: string
  network?: string
  flagBucket?: string
  reason?: string
}

export interface EmittedRealtimeAnalyticsEvent {
  eventName: RealtimeProductEventName
  dimensions: RealtimeProductEventDimensions
  timestamp: number
}

export type RealtimeAnalyticsSink = (
  batch: EmittedRealtimeAnalyticsEvent[],
) => Promise<void> | void

export interface RealtimeAnalyticsTrackerOptions {
  sink?: RealtimeAnalyticsSink
  network?: string
  flagBucket?: string
  /** Deduplication window in ms for identical (eventName + transport + topicFamily + reason) transitions (default: 10000ms) */
  dedupeWindowMs?: number
  /** Sampling rate in [0, 1] (default: 1.0) */
  sampleRate?: number
  /** Maximum queued events before dropping oldest (default: 50) */
  maxQueueSize?: number
  /** Batch size before automatic flush (default: 1; set > 1 to batch) */
  batchSize?: number
  isServer?: boolean
  doNotTrack?: boolean
  saveData?: boolean
  random?: () => number
  now?: () => number
}

const STELLAR_KEY_PATTERN = /\b[GC][A-Z2-7]{10,55}\b/gi
const HEX_ADDRESS_PATTERN = /\b0x[a-fA-F0-9]{6,64}\b/g
const JWT_OR_BEARER_PATTERN = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g

/**
 * Normalizes a raw topic name into a coarse privacy-safe topic family
 * (e.g. `claims:GABC...` -> `claims`, `policies:0x1234...` -> `policies`).
 */
export function sanitizeTopicToCoarseFamily(rawTopic?: string): string | undefined {
  if (!rawTopic) return undefined
  const trimmed = rawTopic.trim()
  if (!trimmed) return undefined

  const baseSegment = trimmed.split(':')[0].split('/')[0].trim()
  const scrubbed = baseSegment
    .replace(STELLAR_KEY_PATTERN, '[redacted]')
    .replace(HEX_ADDRESS_PATTERN, '[redacted]')
    .replace(JWT_OR_BEARER_PATTERN, '[redacted]')
    .toLowerCase()

  return scrubbed || 'unknown'
}

export function scrubAnalyticsDimensionString(value?: string): string | undefined {
  if (!value) return undefined
  return value
    .replace(STELLAR_KEY_PATTERN, '[redacted]')
    .replace(HEX_ADDRESS_PATTERN, '[redacted]')
    .replace(JWT_OR_BEARER_PATTERN, '[redacted]')
    .trim()
}

/**
 * Product analytics emitter for realtime adoption and REST fallback usage.
 * Enforces privacy scrubbing, deduplication, sampling, SSR/DNT guards, and error isolation.
 */
export class RealtimeAnalyticsTracker {
  private readonly sink: RealtimeAnalyticsSink
  private readonly defaultNetwork: string
  private readonly defaultFlagBucket: string
  private readonly dedupeWindowMs: number
  private readonly sampleRate: number
  private readonly maxQueueSize: number
  private readonly batchSize: number
  private readonly isServer: boolean
  private readonly doNotTrack: boolean
  private readonly saveData: boolean
  private readonly random: () => number
  private readonly now: () => number

  private readonly lastEmittedByFingerprint = new Map<string, number>()
  private readonly queue: EmittedRealtimeAnalyticsEvent[] = []

  constructor(options: RealtimeAnalyticsTrackerOptions = {}) {
    this.sink = options.sink ?? (() => {})
    this.defaultNetwork = options.network ?? 'testnet'
    this.defaultFlagBucket = options.flagBucket ?? 'default'
    this.dedupeWindowMs = options.dedupeWindowMs ?? 10_000
    this.sampleRate = Math.min(1, Math.max(0, options.sampleRate ?? 1))
    this.maxQueueSize = Math.max(1, options.maxQueueSize ?? 50)
    this.batchSize = Math.max(1, options.batchSize ?? 1)
    this.isServer = options.isServer ?? typeof window === 'undefined'
    this.doNotTrack = Boolean(options.doNotTrack)
    this.saveData = Boolean(options.saveData)
    this.random = options.random ?? Math.random
    this.now = options.now ?? (() => Date.now())
  }

  public emit(
    eventName: RealtimeProductEventName,
    rawDimensions: {
      transport: RealtimeAnalyticsTransportKind
      topic?: string
      network?: string
      flagBucket?: string
      reason?: string
    },
  ): boolean {
    if (this.isServer || this.doNotTrack || this.saveData) {
      return false
    }

    if (this.sampleRate <= 0 || this.random() > this.sampleRate) {
      return false
    }

    const topicFamily = sanitizeTopicToCoarseFamily(rawDimensions.topic)
    const network =
      scrubAnalyticsDimensionString(rawDimensions.network) ??
      this.defaultNetwork
    const flagBucket =
      scrubAnalyticsDimensionString(rawDimensions.flagBucket) ??
      this.defaultFlagBucket
    const reason = scrubAnalyticsDimensionString(rawDimensions.reason)

    const currentTime = this.now()
    const fingerprint = [
      eventName,
      rawDimensions.transport,
      topicFamily ?? '',
      network,
      flagBucket,
      reason ?? '',
    ].join('|')

    const lastSeen = this.lastEmittedByFingerprint.get(fingerprint)
    if (lastSeen !== undefined && currentTime - lastSeen < this.dedupeWindowMs) {
      return false
    }

    this.lastEmittedByFingerprint.set(fingerprint, currentTime)

    const event: EmittedRealtimeAnalyticsEvent = {
      eventName,
      dimensions: {
        transport: rawDimensions.transport,
        ...(topicFamily ? { topicFamily } : {}),
        network,
        flagBucket,
        ...(reason ? { reason } : {}),
      },
      timestamp: currentTime,
    }

    this.enqueue(event)
    if (this.queue.length >= this.batchSize) {
      void this.flush()
    }

    return true
  }

  public async flush(): Promise<EmittedRealtimeAnalyticsEvent[]> {
    if (this.queue.length === 0) {
      return []
    }
    const batch = this.queue.splice(0, this.queue.length)
    try {
      await this.sink(batch)
    } catch {
      // Analytics failures must never disrupt realtime connection lifecycle
    }
    return batch
  }

  public getQueuedCount(): number {
    return this.queue.length
  }

  private enqueue(event: EmittedRealtimeAnalyticsEvent): void {
    this.queue.push(event)
    while (this.queue.length > this.maxQueueSize) {
      this.queue.shift()
    }
  }
}

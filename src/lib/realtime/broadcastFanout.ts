/**
 * Cross-tab realtime event fan-out and leader promotion over BroadcastChannel (#266).
 *
 * Ensures only the elected leader tab opens an upstream WebSocket/SSE connection
 * and fans decoded events and connection-state transitions out to follower tabs,
 * promoting a follower if the leader tab closes.
 */

export const FANOUT_SCHEMA_VERSION = 1
export const DEFAULT_CHANNEL_NAMESPACE = 'refract:realtime:fanout:v1'

export type TabRole = 'leader' | 'follower'

export type FanoutConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'fallback'

export interface FanoutEventEnvelope<TPayload = unknown> {
  schemaVersion: number
  type: 'event'
  senderTabId: string
  topic: string
  payload: TPayload
  seq?: number
  timestamp: number
}

export interface FanoutStateEnvelope {
  schemaVersion: number
  type: 'state'
  senderTabId: string
  connectionState: FanoutConnectionState
  timestamp: number
}

export interface FanoutControlEnvelope {
  schemaVersion: number
  type: 'leader_heartbeat' | 'leader_resign' | 'leader_claim'
  senderTabId: string
  timestamp: number
}

export type FanoutWireMessage<TPayload = unknown> =
  | FanoutEventEnvelope<TPayload>
  | FanoutStateEnvelope
  | FanoutControlEnvelope

export interface BroadcastChannelLike {
  readonly name: string
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage(message: unknown): void
  close(): void
}

export interface BroadcastFanoutOptions<TPayload = unknown> {
  /** Unique identifier for this tab instance. */
  tabId?: string
  /** Optional instance/network scope appended to the versioned channel name. */
  instanceScope?: string
  /** Custom BroadcastChannel factory (falls back to `globalThis.BroadcastChannel` when available). */
  createChannel?: (channelName: string) => BroadcastChannelLike | null
  /** Maximum serialized byte length for a broadcasted event (default: 65,536 bytes). */
  maxMessageBytes?: number
  /** Timeout in ms before a silent leader is considered closed and a follower promotes itself (default: 4,000ms). */
  leaderTimeoutMs?: number
  /** Interval in ms at which the leader broadcasts heartbeats (default: 1,500ms). */
  heartbeatIntervalMs?: number
  /** Clock provider for deterministic testing. */
  nowFn?: () => number
  /** Invoked when this tab is elected/promoted to leader and should open the upstream socket. */
  onLeaderPromoted?: (subscribedTopics: string[]) => void
  /** Invoked when this tab steps down to follower because an existing leader responded. */
  onDemotedToFollower?: () => void
  /** Invoked on follower tabs (and leader tab if desired) when a valid event is received from the leader. */
  onForwardedEvent?: (event: { topic: string; payload: TPayload; seq?: number; timestamp: number }) => void
  /** Invoked on follower tabs when the leader broadcasts a connection-state change. */
  onConnectionStateChange?: (state: FanoutConnectionState) => void
  /** Invoked when a malformed or schema-mismatched BroadcastChannel message is ignored. */
  onMalformedMessage?: (raw: unknown, reason: string) => void
}

export class BroadcastChannelFanoutNode<TPayload = unknown> {
  private readonly tabId: string
  private readonly channelName: string
  private readonly maxMessageBytes: number
  private readonly leaderTimeoutMs: number
  private readonly heartbeatIntervalMs: number
  private readonly nowFn: () => number
  private readonly onLeaderPromoted?: (subscribedTopics: string[]) => void
  private readonly onDemotedToFollower?: () => void
  private readonly onForwardedEvent?: (event: {
    topic: string
    payload: TPayload
    seq?: number
    timestamp: number
  }) => void
  private readonly onConnectionStateChange?: (state: FanoutConnectionState) => void
  private readonly onMalformedMessage?: (raw: unknown, reason: string) => void

  private channel: BroadcastChannelLike | null = null
  private role: TabRole = 'follower'
  private currentLeaderId: string | null = null
  private readonly subscribedTopics = new Set<string>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private electionTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(options: BroadcastFanoutOptions<TPayload> = {}) {
    this.nowFn = options.nowFn ?? (() => Date.now())
    this.tabId = options.tabId ?? `tab-${this.nowFn()}-${Math.random().toString(36).slice(2, 8)}`
    const scope = options.instanceScope?.trim() || 'default'
    this.channelName = `${DEFAULT_CHANNEL_NAMESPACE}:${scope}`
    this.maxMessageBytes = Math.max(256, options.maxMessageBytes ?? 65_536)
    this.leaderTimeoutMs = Math.max(100, options.leaderTimeoutMs ?? 4_000)
    this.heartbeatIntervalMs = Math.max(50, options.heartbeatIntervalMs ?? 1_500)
    this.onLeaderPromoted = options.onLeaderPromoted
    this.onDemotedToFollower = options.onDemotedToFollower
    this.onForwardedEvent = options.onForwardedEvent
    this.onConnectionStateChange = options.onConnectionStateChange
    this.onMalformedMessage = options.onMalformedMessage

    const factory =
      options.createChannel ??
      ((name: string) =>
        typeof globalThis.BroadcastChannel === 'function'
          ? (new globalThis.BroadcastChannel(name) as unknown as BroadcastChannelLike)
          : null)

    try {
      this.channel = factory(this.channelName)
    } catch {
      this.channel = null
    }
  }

  /**
   * Starts the node. If `BroadcastChannel` is unavailable, immediately promotes
   * this tab to standalone leader so realtime degrades gracefully.
   */
  start(promoteImmediately = false): void {
    this.closed = false
    if (!this.channel) {
      this.promoteToLeader()
      return
    }

    this.channel.onmessage = (evt) => {
      this.handleInboundChannelMessage(evt.data)
    }

    if (promoteImmediately) {
      this.promoteToLeader()
    } else {
      this.resetElectionTimer()
    }
  }

  registerTopic(topic: string): void {
    const trimmed = topic.trim()
    if (trimmed) {
      this.subscribedTopics.add(trimmed)
    }
  }

  unregisterTopic(topic: string): void {
    this.subscribedTopics.delete(topic.trim())
  }

  /**
   * Called by the leader tab when an event arrives from the upstream WebSocket/SSE.
   * Forwards the event one-way to all follower tabs over BroadcastChannel.
   * Follower tabs never call this for messages received from the channel (preventing echo loops).
   */
  publishUpstreamEvent(event: {
    topic: string
    payload: TPayload
    seq?: number
    timestamp?: number
  }): boolean {
    if (this.role !== 'leader' || !this.channel || this.closed) {
      return false
    }

    const envelope: FanoutEventEnvelope<TPayload> = {
      schemaVersion: FANOUT_SCHEMA_VERSION,
      type: 'event',
      senderTabId: this.tabId,
      topic: event.topic,
      payload: event.payload,
      seq: event.seq,
      timestamp: event.timestamp ?? this.nowFn(),
    }

    try {
      const serialized = JSON.stringify(envelope)
      if (serialized.length > this.maxMessageBytes) {
        this.onMalformedMessage?.(
          envelope,
          `Outbound fan-out message size ${serialized.length} exceeds limit ${this.maxMessageBytes}`
        )
        return false
      }
      this.channel.postMessage(envelope)
      return true
    } catch {
      return false
    }
  }

  /**
   * Called by the leader tab to broadcast connection-state changes to followers.
   */
  publishConnectionState(connectionState: FanoutConnectionState): boolean {
    if (this.role !== 'leader' || !this.channel || this.closed) {
      return false
    }
    const envelope: FanoutStateEnvelope = {
      schemaVersion: FANOUT_SCHEMA_VERSION,
      type: 'state',
      senderTabId: this.tabId,
      connectionState,
      timestamp: this.nowFn(),
    }
    try {
      this.channel.postMessage(envelope)
      return true
    } catch {
      return false
    }
  }

  /**
   * Closes the tab's BroadcastChannel participation. If this tab is the leader,
   * broadcasts an explicit `leader_resign` message so a follower can promote immediately.
   */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.clearTimers()

    if (this.role === 'leader' && this.channel) {
      try {
        const resignMsg: FanoutControlEnvelope = {
          schemaVersion: FANOUT_SCHEMA_VERSION,
          type: 'leader_resign',
          senderTabId: this.tabId,
          timestamp: this.nowFn(),
        }
        this.channel.postMessage(resignMsg)
      } catch {
        // Ignore errors during close
      }
    }

    if (this.channel) {
      this.channel.onmessage = null
      this.channel.close()
      this.channel = null
    }
  }

  getRole(): TabRole {
    return this.role
  }

  getTabId(): string {
    return this.tabId
  }

  getChannelName(): string {
    return this.channelName
  }

  promoteToLeader(): void {
    if (this.closed || this.role === 'leader') return
    this.role = 'leader'
    this.currentLeaderId = this.tabId
    this.clearTimers()

    if (this.channel) {
      const claimMsg: FanoutControlEnvelope = {
        schemaVersion: FANOUT_SCHEMA_VERSION,
        type: 'leader_claim',
        senderTabId: this.tabId,
        timestamp: this.nowFn(),
      }
      this.channel.postMessage(claimMsg)

      this.heartbeatTimer = setInterval(() => {
        if (this.role === 'leader' && this.channel && !this.closed) {
          const hb: FanoutControlEnvelope = {
            schemaVersion: FANOUT_SCHEMA_VERSION,
            type: 'leader_heartbeat',
            senderTabId: this.tabId,
            timestamp: this.nowFn(),
          }
          this.channel.postMessage(hb)
        }
      }, this.heartbeatIntervalMs)
    }

    this.onLeaderPromoted?.(Array.from(this.subscribedTopics))
  }

  private handleInboundChannelMessage(raw: unknown): void {
    if (this.closed) return

    const validation = this.validateInboundMessage(raw)
    if (!validation.ok) {
      this.onMalformedMessage?.(raw, validation.reason)
      return
    }

    const msg = validation.value
    if (msg.senderTabId === this.tabId) {
      // Never process or echo our own messages
      return
    }

    if (msg.type === 'leader_claim' || msg.type === 'leader_heartbeat') {
      if (this.role === 'leader') {
        // Tie-breaker: lexicographically lower tabId remains leader
        if (msg.senderTabId < this.tabId) {
          this.role = 'follower'
          this.currentLeaderId = msg.senderTabId
          this.clearTimers()
          this.resetElectionTimer()
          this.onDemotedToFollower?.()
        }
        return
      }
      this.currentLeaderId = msg.senderTabId
      this.resetElectionTimer()
      return
    }

    if (msg.type === 'leader_resign') {
      if (this.role === 'follower') {
        this.promoteToLeader()
      }
      return
    }

    if (msg.type === 'event') {
      this.resetElectionTimer()
      // Follower applies the forwarded event locally and NEVER re-broadcasts it
      if (this.role === 'follower') {
        this.onForwardedEvent?.({
          topic: msg.topic,
          payload: msg.payload as TPayload,
          seq: msg.seq,
          timestamp: msg.timestamp,
        })
      }
      return
    }

    if (msg.type === 'state') {
      this.resetElectionTimer()
      if (this.role === 'follower') {
        this.onConnectionStateChange?.(msg.connectionState)
      }
    }
  }

  private validateInboundMessage(
    raw: unknown
  ): { ok: true; value: FanoutWireMessage<TPayload> } | { ok: false; reason: string } {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, reason: 'Channel message must be an object' }
    }

    const candidate = raw as Record<string, unknown>
    if (candidate.schemaVersion !== FANOUT_SCHEMA_VERSION) {
      return {
        ok: false,
        reason: `Unsupported fanout schemaVersion: ${String(candidate.schemaVersion)}`,
      }
    }

    if (typeof candidate.senderTabId !== 'string' || !candidate.senderTabId.trim()) {
      return { ok: false, reason: 'Missing senderTabId' }
    }

    if (typeof candidate.timestamp !== 'number' || !Number.isFinite(candidate.timestamp)) {
      return { ok: false, reason: 'Missing or invalid timestamp' }
    }

    const type = candidate.type
    if (
      type === 'leader_heartbeat' ||
      type === 'leader_resign' ||
      type === 'leader_claim'
    ) {
      return { ok: true, value: candidate as unknown as FanoutControlEnvelope }
    }

    if (type === 'state') {
      if (typeof candidate.connectionState !== 'string') {
        return { ok: false, reason: 'Missing connectionState in state envelope' }
      }
      return { ok: true, value: candidate as unknown as FanoutStateEnvelope }
    }

    if (type === 'event') {
      if (typeof candidate.topic !== 'string' || !candidate.topic.trim()) {
        return { ok: false, reason: 'Missing topic in event envelope' }
      }
      return { ok: true, value: candidate as unknown as FanoutEventEnvelope<TPayload> }
    }

    return { ok: false, reason: `Unknown fanout message type: ${String(type)}` }
  }

  private resetElectionTimer(): void {
    if (this.electionTimer !== null) {
      clearTimeout(this.electionTimer)
      this.electionTimer = null
    }
    if (this.role === 'follower' && !this.closed) {
      this.electionTimer = setTimeout(() => {
        this.electionTimer = null
        if (this.role === 'follower' && !this.closed) {
          this.promoteToLeader()
        }
      }, this.leaderTimeoutMs)
    }
  }

  private clearTimers(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.electionTimer !== null) {
      clearTimeout(this.electionTimer)
      this.electionTimer = null
    }
  }
}

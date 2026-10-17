/**
 * Cursor-based long-poll fallback transport for environments where neither
 * WebSocket upgrades nor Server-Sent Events (EventSource) are available (#245).
 *
 * Delivers subscription requests as sequential HTTP GET requests carrying the
 * active topic list and last-seen cursor, enforcing single in-flight request
 * concurrency, AbortController teardown, and 429/5xx exponential backoff.
 */

export type LongPollState = 'idle' | 'connecting' | 'connected' | 'backoff' | 'disconnected'

export interface LongPollEventEnvelope<TPayload = unknown> {
  topic: string
  eventId?: string
  cursor?: string | number
  sequence?: number
  timestamp: number
  payload: TPayload
}

export interface LongPollResponsePayload {
  cursor?: string | number
  timeoutMs?: number
  events: LongPollEventEnvelope[]
}

export interface LongPollTransportOptions {
  /** Base endpoint URL for the long-poll bridge (e.g. `/api/realtime/poll`). */
  endpoint: string
  /** Optional custom fetch implementation for testing or custom auth wrappers. */
  fetchFn?: typeof fetch
  /** Client-side request timeout per poll cycle in milliseconds (default: 25,000ms). */
  requestTimeoutMs?: number
  /** Base backoff delay on 429/5xx or network error in milliseconds (default: 1,000ms). */
  baseBackoffMs?: number
  /** Maximum backoff delay in milliseconds (default: 30,000ms). */
  maxBackoffMs?: number
  /** Optional initial cursor to resume from a previous session or snapshot. */
  initialCursor?: string | number | null
  /** Optional callback to supply auth or correlation headers on every poll request. */
  getHeaders?: () => Record<string, string>
  /** Invoked whenever an inbound event arrives from the long-poll response. */
  onMessage?: (event: LongPollEventEnvelope) => void
  /** Invoked when transport state transitions. */
  onStateChange?: (state: LongPollState) => void
  /** Invoked when a poll request encounters an HTTP or network error. */
  onError?: (error: Error, statusCode?: number) => void
}

export class LongPollTransport {
  private readonly endpoint: string
  private readonly fetchFn: typeof fetch
  private requestTimeoutMs: number
  private readonly baseBackoffMs: number
  private readonly maxBackoffMs: number
  private readonly getHeaders?: () => Record<string, string>
  private readonly onMessage?: (event: LongPollEventEnvelope) => void
  private readonly onStateChange?: (state: LongPollState) => void
  private readonly onError?: (error: Error, statusCode?: number) => void

  private state: LongPollState = 'idle'
  private readonly topics = new Set<string>()
  private cursor: string | number | null
  private consecutiveFailures = 0
  private inFlightAbort: AbortController | null = null
  private inFlightPromise: Promise<void> | null = null
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private pausedForVisibility = false

  constructor(options: LongPollTransportOptions) {
    this.endpoint = options.endpoint
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis)
    this.requestTimeoutMs = options.requestTimeoutMs ?? 25_000
    this.baseBackoffMs = options.baseBackoffMs ?? 1_000
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000
    this.cursor = options.initialCursor ?? null
    this.getHeaders = options.getHeaders
    this.onMessage = options.onMessage
    this.onStateChange = options.onStateChange
    this.onError = options.onError
  }

  /**
   * Starts the long-poll loop. Idempotent if already connecting or connected.
   */
  connect(): void {
    if (this.state === 'connecting' || this.state === 'connected') {
      return
    }
    this.pausedForVisibility = false
    this.transitionTo('connecting')
    this.scheduleNextPoll(0)
  }

  /**
   * Immediately aborts any in-flight request, clears timers, and stops polling.
   */
  disconnect(): void {
    this.clearTimersAndAbort()
    this.consecutiveFailures = 0
    this.transitionTo('disconnected')
  }

  /**
   * Subscribes to a topic. If already active, triggers a fresh poll with the updated topic list.
   */
  subscribe(topic: string): void {
    const trimmed = topic.trim()
    if (!trimmed || this.topics.has(trimmed)) return
    this.topics.add(trimmed)
    if (this.isRunning() && !this.pausedForVisibility) {
      this.restartInFlightPoll()
    }
  }

  /**
   * Unsubscribes from a topic.
   */
  unsubscribe(topic: string): void {
    const trimmed = topic.trim()
    if (!this.topics.delete(trimmed)) return
    if (this.topics.size === 0 && this.isRunning()) {
      this.clearTimersAndAbort()
    }
  }

  /**
   * Sends an outbound control message or command via POST to the long-poll endpoint.
   */
  async send(payload: unknown): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.getHeaders ? this.getHeaders() : {}),
    }
    const response = await this.fetchFn(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      throw new Error(`Long-poll send failed with HTTP ${response.status}`)
    }
  }

  /**
   * Pauses or resumes in-flight long-poll requests when page visibility changes
   * so background tabs do not stack requests.
   */
  setVisibilityPaused(paused: boolean): void {
    if (this.pausedForVisibility === paused) return
    this.pausedForVisibility = paused
    if (paused) {
      this.clearTimersAndAbort()
    } else if (this.state !== 'idle' && this.state !== 'disconnected') {
      this.scheduleNextPoll(0)
    }
  }

  /**
   * Updates or resets the resume cursor (e.g. after a snapshot fetch).
   */
  setCursor(cursor: string | number | null): void {
    this.cursor = cursor
  }

  getCursor(): string | number | null {
    return this.cursor
  }

  getState(): LongPollState {
    return this.state
  }

  getSubscribedTopics(): string[] {
    return Array.from(this.topics).sort()
  }

  /**
   * Executes a single poll cycle (exposed for deterministic testing).
   */
  async pollOnce(): Promise<void> {
    if (this.inFlightPromise) {
      return this.inFlightPromise
    }
    if (this.topics.size === 0 || this.pausedForVisibility) {
      return
    }

    const abortController = new AbortController()
    this.inFlightAbort = abortController
    const timeoutId = setTimeout(() => {
      abortController.abort(new Error('Long-poll request timeout'))
    }, this.requestTimeoutMs)

    const run = async () => {
      try {
        const url = this.buildPollUrl()
        const headers: Record<string, string> = {
          Accept: 'application/json',
          ...(this.getHeaders ? this.getHeaders() : {}),
        }

        const response = await this.fetchFn(url, {
          method: 'GET',
          headers,
          signal: abortController.signal,
        })

        if (!response.ok) {
          const retryAfterHeader = response.headers?.get?.('Retry-After')
          const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined
          this.handlePollFailure(
            new Error(`Long-poll HTTP error ${response.status}`),
            response.status,
            retryAfterMs
          )
          return
        }

        const body = (await response.json()) as LongPollResponsePayload
        this.consecutiveFailures = 0
        this.transitionTo('connected')

        if (typeof body.timeoutMs === 'number' && body.timeoutMs > 0) {
          this.requestTimeoutMs = body.timeoutMs
        }

        if (body.cursor !== undefined && body.cursor !== null) {
          this.cursor = body.cursor
        }

        if (Array.isArray(body.events)) {
          for (const event of body.events) {
            if (event.cursor !== undefined && event.cursor !== null) {
              this.cursor = event.cursor
            }
            this.onMessage?.(event)
          }
        }

        if (this.isRunning() && !this.pausedForVisibility) {
          this.scheduleNextPoll(0)
        }
      } catch (err) {
        if (abortController.signal.aborted) {
          const reason = abortController.signal.reason
          if (reason instanceof Error && reason.message === 'Long-poll request timeout') {
            // Normal long-poll timeout expiry: reconnect immediately without failure penalty
            this.transitionTo('connected')
            if (this.isRunning() && !this.pausedForVisibility) {
              this.scheduleNextPoll(0)
            }
          }
          return
        }
        const error = err instanceof Error ? err : new Error(String(err))
        this.handlePollFailure(error)
      } finally {
        clearTimeout(timeoutId)
        if (this.inFlightAbort === abortController) {
          this.inFlightAbort = null
        }
        this.inFlightPromise = null
      }
    }

    this.inFlightPromise = run()
    return this.inFlightPromise
  }

  private buildPollUrl(): string {
    const params = new URLSearchParams()
    const sortedTopics = this.getSubscribedTopics()
    if (sortedTopics.length > 0) {
      params.set('topics', sortedTopics.join(','))
    }
    if (this.cursor !== null && this.cursor !== undefined) {
      params.set('cursor', String(this.cursor))
    }
    const separator = this.endpoint.includes('?') ? '&' : '?'
    return `${this.endpoint}${separator}${params.toString()}`
  }

  private handlePollFailure(error: Error, statusCode?: number, retryAfterMs?: number): void {
    this.consecutiveFailures += 1
    this.onError?.(error, statusCode)
    this.transitionTo('backoff')

    const computedBackoff = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * Math.pow(2, this.consecutiveFailures - 1)
    )
    const delayMs =
      retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? Math.min(this.maxBackoffMs, Math.max(computedBackoff, retryAfterMs))
        : computedBackoff

    if (this.isRunning() && !this.pausedForVisibility) {
      this.scheduleNextPoll(delayMs)
    }
  }

  private scheduleNextPoll(delayMs: number): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    if (this.topics.size === 0 || this.pausedForVisibility) {
      return
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null
      if (this.isRunning() && !this.pausedForVisibility) {
        void this.pollOnce()
      }
    }, delayMs)
  }

  private restartInFlightPoll(): void {
    this.clearTimersAndAbort()
    this.scheduleNextPoll(0)
  }

  private clearTimersAndAbort(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    if (this.inFlightAbort) {
      this.inFlightAbort.abort()
      this.inFlightAbort = null
    }
  }

  private isRunning(): boolean {
    return (
      this.state === 'connecting' ||
      this.state === 'connected' ||
      this.state === 'backoff'
    )
  }

  private transitionTo(nextState: LongPollState): void {
    if (this.state === nextState) return
    this.state = nextState
    this.onStateChange?.(nextState)
  }
}

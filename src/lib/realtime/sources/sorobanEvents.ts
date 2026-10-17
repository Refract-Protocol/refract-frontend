export interface SorobanRpcRawEvent {
  id: string
  type?: 'contract' | 'system' | 'diagnostic'
  ledger: number
  ledgerClosedAt: string
  contractId: string
   pagingToken: string
  topic: string[]
  value: unknown
  txHash?: string
  inSuccessfulContractCall?: boolean
}

export interface SorobanGetEventsResult {
  events: SorobanRpcRawEvent[]
  latestLedger: number
  oldestLedger?: number
  cursor?: string
}

export interface SorobanLatestLedgerResult {
  id: string
  protocolVersion: number
  sequence: number
}

export interface NormalizedSorobanRealtimeEvent<T = unknown> {
  eventId: string
  topic: string
  contractId: string
  ledger: number
  ledgerClosedAt: string
  pagingToken: string
  txHash?: string
  rawTopics: string[]
  payload: T
}

export interface SorobanCursorCheckpoint {
  pagingToken?: string
  lastLedger: number
  updatedAt: number
}

export interface SorobanCheckpointStore {
  get(key: string): SorobanCursorCheckpoint | null
  set(key: string, checkpoint: SorobanCursorCheckpoint): void
  clear(key: string): void
}

export interface SorobanEventsAdapterOptions {
  rpcUrl: string
  networkPassphrase?: string
  policyContractId?: string
  poolContractId?: string
  pollIntervalMs?: number
  baseBackoffMs?: number
  maxBackoffMs?: number
  pageLimit?: number
  maxSeenEventIds?: number
  fetchImpl?: typeof fetch
  checkpointStore?: SorobanCheckpointStore
  random?: () => number
  now?: () => number
  onEvent?: (event: NormalizedSorobanRealtimeEvent) => void
  onRetentionGap?: (info: {
    requestedStartLedger: number
    oldestLedger: number
    latestLedger: number
  }) => Promise<void> | void
  onError?: (error: Error, backoffDelayMs: number) => void
}

export class SorobanRpcHttpError extends Error {
  public readonly status: number
  public readonly retryable: boolean

  constructor(message: string, status: number) {
    super(message)
    this.name = 'SorobanRpcHttpError'
    this.status = status
    this.retryable = status === 429 || status >= 500
  }
}

export function createInMemorySorobanCheckpointStore(): SorobanCheckpointStore {
  const map = new Map<string, SorobanCursorCheckpoint>()
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, checkpoint) => {
      map.set(key, { ...checkpoint })
    },
    clear: (key) => {
      map.delete(key)
    },
  }
}

/**
 * Normalizes a Soroban contract event into a standard Refract realtime topic & envelope.
 */
export function normalizeSorobanContractEvent(
  raw: SorobanRpcRawEvent,
  contracts: { policyContractId?: string; poolContractId?: string },
): NormalizedSorobanRealtimeEvent {
  const firstSymbol = (raw.topic[0] ?? 'update').toLowerCase()
  const secondSegment = raw.topic[1]

  let domain = 'contract'
  if (contracts.poolContractId && raw.contractId === contracts.poolContractId) {
    domain = 'pool'
  } else if (contracts.policyContractId && raw.contractId === contracts.policyContractId) {
    domain = firstSymbol.includes('claim') ? 'claims' : 'policies'
  } else if (firstSymbol.includes('claim')) {
    domain = 'claims'
  } else if (firstSymbol.includes('pool') || firstSymbol.includes('liquidity')) {
    domain = 'pool'
  }

  const normalizedTopic = secondSegment
    ? `${domain}:${firstSymbol}:${secondSegment}`
    : `${domain}:${firstSymbol}`

  return {
    eventId: raw.id,
    topic: normalizedTopic,
    contractId: raw.contractId,
    ledger: raw.ledger,
    ledgerClosedAt: raw.ledgerClosedAt,
    pagingToken: raw.pagingToken,
    txHash: raw.txHash,
    rawTopics: [...raw.topic],
    payload: raw.value,
  }
}

/**
 * Backend-independent realtime source that polls Soroban RPC `getEvents`,
 * checkpoints cursors per network/contract set, deduplicates events, and
 * handles retention-window gaps and rate-limit backoff.
 */
export class SorobanEventsAdapter {
  private readonly options: SorobanEventsAdapterOptions
  private readonly store: SorobanCheckpointStore
  private readonly fetchFn: typeof fetch
  private readonly random: () => number
  private readonly now: () => number
  private readonly maxSeenIds: number
  private readonly seenIds = new Set<string>()
  private readonly seenOrder: string[] = []
  private readonly listeners = new Set<(event: NormalizedSorobanRealtimeEvent) => void>()

  private running = false
  private timerId: ReturnType<typeof setTimeout> | null = null
  private consecutiveFailures = 0
  private requestIdCounter = 0

  constructor(options: SorobanEventsAdapterOptions) {
    this.options = options
    this.store = options.checkpointStore ?? createInMemorySorobanCheckpointStore()
    this.fetchFn = options.fetchImpl ?? fetch
    this.random = options.random ?? Math.random
    this.now = options.now ?? (() => Date.now())
    this.maxSeenIds = options.maxSeenEventIds ?? 500
  }

  public getConfiguredContractIds(): string[] {
    const ids: string[] = []
    if (this.options.policyContractId?.trim()) {
      ids.push(this.options.policyContractId.trim())
    }
    if (this.options.poolContractId?.trim()) {
      ids.push(this.options.poolContractId.trim())
    }
    return Array.from(new Set(ids))
  }

  public isEnabled(): boolean {
    return (
      Boolean(this.options.rpcUrl?.trim()) &&
      this.getConfiguredContractIds().length > 0
    )
  }

  public getCheckpointKey(): string {
    const network = this.options.networkPassphrase?.trim() || 'default-network'
    const contracts = this.getConfiguredContractIds().sort().join(',')
    return `soroban-events:${network}:${contracts}`
  }

  public subscribe(listener: (event: NormalizedSorobanRealtimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public start(): void {
    if (this.running || !this.isEnabled()) {
      return
    }
    this.running = true
    this.scheduleNext(0)
  }

  public stop(): void {
    this.running = false
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
  }

  /**
   * Executes a single poll cycle against Soroban JSON-RPC `getEvents`.
   * Clean no-op returning `[]` when contract IDs are unset.
   */
  public async pollOnce(): Promise<NormalizedSorobanRealtimeEvent[]> {
    if (!this.isEnabled()) {
      return []
    }

    const contractIds = this.getConfiguredContractIds()
    const checkpointKey = this.getCheckpointKey()
    let checkpoint = this.store.get(checkpointKey)

    if (!checkpoint) {
      const latest = await this.rpcCall<SorobanLatestLedgerResult>('getLatestLedger', {})
      checkpoint = {
        lastLedger: latest.sequence,
        updatedAt: this.now(),
      }
      this.store.set(checkpointKey, checkpoint)
    }

    const filter = [
      {
        type: 'contract',
        contractIds,
      },
    ]

    const pagination: Record<string, unknown> = {
      limit: this.options.pageLimit ?? 100,
    }

    const params: Record<string, unknown> = {
      filters: filter,
      pagination,
    }

    if (checkpoint.pagingToken) {
      pagination.cursor = checkpoint.pagingToken
    } else {
      params.startLedger = checkpoint.lastLedger
    }

    let response: SorobanGetEventsResult
    try {
      response = await this.rpcCall<SorobanGetEventsResult>('getEvents', params)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Handle RPC error indicating startLedger is before oldestLedger retention window
      if (msg.toLowerCase().includes('startledger') || msg.toLowerCase().includes('ledger range')) {
        const latest = await this.rpcCall<SorobanLatestLedgerResult>('getLatestLedger', {})
        await this.options.onRetentionGap?.({
          requestedStartLedger: checkpoint.lastLedger,
          oldestLedger: latest.sequence,
          latestLedger: latest.sequence,
        })
        this.store.set(checkpointKey, {
          lastLedger: latest.sequence,
          updatedAt: this.now(),
        })
        return []
      }
      throw err
    }

    // Check if retention gap is reported directly in response metadata
    if (
      !checkpoint.pagingToken &&
      typeof response.oldestLedger === 'number' &&
      checkpoint.lastLedger < response.oldestLedger
    ) {
      await this.options.onRetentionGap?.({
        requestedStartLedger: checkpoint.lastLedger,
        oldestLedger: response.oldestLedger,
        latestLedger: response.latestLedger,
      })
      this.store.set(checkpointKey, {
        lastLedger: response.oldestLedger,
        updatedAt: this.now(),
      })
    }

    const emitted: NormalizedSorobanRealtimeEvent[] = []
    let latestPagingToken = checkpoint.pagingToken
    let highestLedger = Math.max(checkpoint.lastLedger, response.latestLedger || checkpoint.lastLedger)

    for (const raw of response.events ?? []) {
      if (raw.inSuccessfulContractCall === false) {
        continue
      }
      latestPagingToken = raw.pagingToken || latestPagingToken
      if (raw.ledger > highestLedger) {
        highestLedger = raw.ledger
      }

      if (this.hasSeenEvent(raw.id)) {
        continue
      }
      this.markEventSeen(raw.id)

      const normalized = normalizeSorobanContractEvent(raw, {
        policyContractId: this.options.policyContractId,
        poolContractId: this.options.poolContractId,
      })

      emitted.push(normalized)
      this.options.onEvent?.(normalized)
      for (const listener of Array.from(this.listeners)) {
        listener(normalized)
      }
    }

    if (response.cursor) {
      latestPagingToken = response.cursor
    }

    this.store.set(checkpointKey, {
      pagingToken: latestPagingToken,
      lastLedger: highestLedger,
      updatedAt: this.now(),
    })

    this.consecutiveFailures = 0
    return emitted
  }

  public computeBackoffDelayMs(failureCount: number): number {
    const base = this.options.baseBackoffMs ?? 1_000
    const max = this.options.maxBackoffMs ?? 30_000
    const exp = Math.min(max, base * Math.pow(2, Math.max(0, failureCount - 1)))
    const jitterFactor = 0.75 + this.random() * 0.5
    return Math.min(max, Math.round(exp * jitterFactor))
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return
    this.timerId = setTimeout(async () => {
      if (!this.running) return
      try {
        await this.pollOnce()
        this.scheduleNext(this.options.pollIntervalMs ?? 4_000)
      } catch (err) {
        this.consecutiveFailures += 1
        const errorObj = err instanceof Error ? err : new Error(String(err))
        const backoffMs = this.computeBackoffDelayMs(this.consecutiveFailures)
        this.options.onError?.(errorObj, backoffMs)
        this.scheduleNext(backoffMs)
      }
    }, delayMs)
  }

  private hasSeenEvent(eventId: string): boolean {
    return this.seenIds.has(eventId)
  }

  private markEventSeen(eventId: string): void {
    if (this.seenIds.has(eventId)) return
    this.seenIds.add(eventId)
    this.seenOrder.push(eventId)
    while (this.seenOrder.length > this.maxSeenIds) {
      const oldest = this.seenOrder.shift()
      if (oldest !== undefined) {
        this.seenIds.delete(oldest)
      }
    }
  }

  private async rpcCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
    this.requestIdCounter += 1
    const res = await this.fetchFn(this.options.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.requestIdCounter,
        method,
        params,
      }),
    })

    if (!res.ok) {
      throw new SorobanRpcHttpError(
        `Soroban RPC HTTP ${res.status} on ${method}`,
        res.status,
      )
    }

    const body = (await res.json()) as {
      result?: T
      error?: { code?: number; message?: string }
    }

    if (body.error) {
      throw new Error(body.error.message || `Soroban RPC error (${body.error.code ?? 'unknown'})`)
    }

    if (body.result === undefined) {
      throw new Error(`Soroban RPC missing result for ${method}`)
    }

    return body.result
  }
}

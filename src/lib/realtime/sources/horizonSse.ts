export type SupportedStellarNetwork = 'testnet' | 'mainnet' | 'futurenet'

export interface RawHorizonOperationRecord {
  id: string
  paging_token: string
  type: string
  created_at: string
  transaction_hash: string
  source_account: string
  transaction_successful?: boolean
  amount?: string
  asset_type?: string
  asset_code?: string
  from?: string
  to?: string
}

export interface DomainAccountOperation {
  id: string
  pagingToken: string
  type: string
  createdAt: string
  transactionHash: string
  sourceAccount: string
  amount?: string
  assetCode: string
  counterparty?: string
}

export interface FakeEventSourceLike {
  url: string
  onmessage: ((ev: { data: string; lastEventId?: string }) => void) | null
  onerror: ((err: unknown) => void) | null
  close: () => void
}

export interface HorizonSseAdapterOptions {
  accountId: string
  network: string
  initialCursor?: string
  baseBackoffMs?: number
  maxBackoffMs?: number
  createEventSource?: (url: string) => FakeEventSourceLike
  onOperation?: (op: DomainAccountOperation, allOperations: DomainAccountOperation[]) => void
  onStreamStateChange?: (state: 'connecting' | 'streaming' | 'reconnecting' | 'closed') => void
}

const HORIZON_URLS: Record<SupportedStellarNetwork, string> = {
  testnet: 'https://horizon-testnet.stellar.org',
  mainnet: 'https://horizon.stellar.org',
  futurenet: 'https://horizon-futurenet.stellar.org',
}

export function resolveHorizonBaseUrl(network: string): string {
  const normalized = network.trim().toLowerCase()
  if (normalized === 'public') {
    return HORIZON_URLS.mainnet
  }
  if (normalized in HORIZON_URLS) {
    return HORIZON_URLS[normalized as SupportedStellarNetwork]
  }
  throw new Error(
    `Unsupported Stellar network "${network}". Expected one of: testnet, mainnet, futurenet.`,
  )
}

export function mapHorizonOperationToDomain(
  raw: RawHorizonOperationRecord,
  accountId: string,
): DomainAccountOperation {
  const assetCode =
    raw.asset_type === 'native' || !raw.asset_code ? 'XLM' : raw.asset_code
  const counterparty =
    raw.from && raw.from !== accountId
      ? raw.from
      : raw.to && raw.to !== accountId
        ? raw.to
        : undefined

  return {
    id: raw.id,
    pagingToken: raw.paging_token,
    type: raw.type,
    createdAt: raw.created_at,
    transactionHash: raw.transaction_hash,
    sourceAccount: raw.source_account,
    ...(raw.amount !== undefined ? { amount: raw.amount } : {}),
    assetCode,
    ...(counterparty !== undefined ? { counterparty } : {}),
  }
}

function comparePagingTokens(a: string, b: string): number {
  if (a === b) return 0
  try {
    const bigA = BigInt(a)
    const bigB = BigInt(b)
    return bigA > bigB ? 1 : -1
  } catch {
    return a.localeCompare(b)
  }
}

/**
 * First-class Horizon SSE streaming adapter for `/accounts/{id}/operations`
 * with REST snapshot hydration, monotonic `paging_token` cursor resume,
 * deduplication, and single-stream-per-account lifecycle management.
 */
export class HorizonOperationsSseAdapter {
  private accountId: string
  private network: string
  private cursor: string
  private readonly baseBackoffMs: number
  private readonly maxBackoffMs: number
  private readonly createEventSource: (url: string) => FakeEventSourceLike
  private readonly onOperation?: (
    op: DomainAccountOperation,
    allOperations: DomainAccountOperation[],
  ) => void
  private readonly onStreamStateChange?: (
    state: 'connecting' | 'streaming' | 'reconnecting' | 'closed',
  ) => void

  private activeSource: FakeEventSourceLike | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private closedByUser = false
  private readonly seenIds = new Set<string>()
  private readonly operations: DomainAccountOperation[] = []

  constructor(options: HorizonSseAdapterOptions) {
    this.accountId = options.accountId.trim()
    this.network = options.network.trim().toLowerCase()
    // Validate network immediately on construction
    resolveHorizonBaseUrl(this.network)

    this.cursor = options.initialCursor?.trim() || 'now'
    this.baseBackoffMs = options.baseBackoffMs ?? 1_000
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000
    this.createEventSource =
      options.createEventSource ??
      ((url: string) => new EventSource(url) as unknown as FakeEventSourceLike)
    this.onOperation = options.onOperation
    this.onStreamStateChange = options.onStreamStateChange
  }

  public buildStreamUrl(): string {
    const base = resolveHorizonBaseUrl(this.network)
    const encodedAccount = encodeURIComponent(this.accountId)
    const encodedCursor = encodeURIComponent(this.cursor)
    return `${base}/accounts/${encodedAccount}/operations?cursor=${encodedCursor}&order=asc`
  }

  /**
   * Hydrates initial operation history from the paged REST fetch and advances
   * the resume cursor to the highest `paging_token`.
   */
  public seedRestOperations(records: RawHorizonOperationRecord[]): DomainAccountOperation[] {
    for (const raw of records) {
      if (raw.transaction_successful === false) continue
      if (this.seenIds.has(raw.id)) continue

      const mapped = mapHorizonOperationToDomain(raw, this.accountId)
      this.seenIds.add(mapped.id)
      this.operations.push(mapped)

      if (
        this.cursor === 'now' ||
        comparePagingTokens(mapped.pagingToken, this.cursor) > 0
      ) {
        this.cursor = mapped.pagingToken
      }
    }

    // Sort newest-first for UI display
    this.operations.sort((a, b) =>
      comparePagingTokens(b.pagingToken, a.pagingToken),
    )
    return this.getOperations()
  }

  public start(): void {
    this.closedByUser = false
    this.openStream()
  }

  public stop(): void {
    this.closedByUser = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.activeSource) {
      this.activeSource.close()
      this.activeSource = null
    }
    this.onStreamStateChange?.('closed')
  }

  /**
   * Switches account or Stellar network, tearing down any existing SSE stream
   * so at most one Horizon stream exists at any time.
   */
  public switchScope(nextAccountId: string, nextNetwork: string): void {
    const normalizedNetwork = nextNetwork.trim().toLowerCase()
    resolveHorizonBaseUrl(normalizedNetwork)

    this.stop()
    this.accountId = nextAccountId.trim()
    this.network = normalizedNetwork
    this.cursor = 'now'
    this.seenIds.clear()
    this.operations.length = 0
    this.reconnectAttempt = 0
    this.start()
  }

  public getCursor(): string {
    return this.cursor
  }

  public getOperations(): DomainAccountOperation[] {
    return [...this.operations]
  }

  public getActiveSource(): FakeEventSourceLike | null {
    return this.activeSource
  }

  private openStream(): void {
    if (this.closedByUser) return
    if (this.activeSource) {
      this.activeSource.close()
      this.activeSource = null
    }

    this.onStreamStateChange?.('connecting')
    const source = this.createEventSource(this.buildStreamUrl())
    this.activeSource = source

    source.onmessage = (event) => {
      this.reconnectAttempt = 0
      this.onStreamStateChange?.('streaming')
      this.handleRawSseData(event.data, event.lastEventId)
    }

    source.onerror = () => {
      if (this.closedByUser) return
      source.close()
      this.activeSource = null
      this.scheduleReconnect()
    }
  }

  private handleRawSseData(rawData: string, lastEventId?: string): void {
    const trimmed = rawData.trim()
    if (!trimmed || trimmed === '"hello"' || trimmed === 'byebye') {
      return
    }

    let parsed: RawHorizonOperationRecord
    try {
      parsed = JSON.parse(trimmed) as RawHorizonOperationRecord
    } catch {
      return
    }

    if (!parsed.id || !parsed.paging_token) return
    if (parsed.transaction_successful === false) return

    const candidateCursor = lastEventId?.trim() || parsed.paging_token
    // Ignore events at or behind the already-hydrated cursor or already seen ID
    if (
      this.seenIds.has(parsed.id) ||
      (this.cursor !== 'now' &&
        comparePagingTokens(candidateCursor, this.cursor) <= 0)
    ) {
      return
    }

    const mapped = mapHorizonOperationToDomain(parsed, this.accountId)
    this.seenIds.add(mapped.id)
    this.cursor = candidateCursor
    // Prepend newest operation at the top of the history list
    this.operations.unshift(mapped)
    this.onOperation?.(mapped, this.getOperations())
  }

  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer !== null) return
    this.onStreamStateChange?.('reconnecting')
    const delay = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * Math.pow(2, this.reconnectAttempt),
    )
    this.reconnectAttempt += 1

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.openStream()
    }, delay)
  }
}

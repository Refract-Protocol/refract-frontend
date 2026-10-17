export interface StellarAssetBalance {
  assetCode: string
  assetIssuer?: string
  balance: string
  decimals: number
}

export interface StellarAccountSnapshot {
  accountId: string
  network: string
  sequence: string
  subentryCount: number
  balances: StellarAssetBalance[]
  updatedAt: number
}

export interface AccountBalanceViewState {
  accountId: string | null
  network: string
  balances: Record<string, StellarAssetBalance>
  sequence: string | null
  subentryCount: number
  updatedAt: number | null
  isStale: boolean
  isLoading: boolean
  isUnfunded: boolean
  hasPendingOptimisticDelta: boolean
}

export interface AccountBalanceStreamOptions {
  initialAccountId?: string | null
  initialNetwork?: string
  staleAfterMs?: number
  now?: () => number
  onSubscribeTopic?: (topic: string) => void
  onUnsubscribeTopic?: (topic: string) => void
}

export function getAssetKey(assetCode: string, assetIssuer?: string): string {
  const code = assetCode.trim().toUpperCase()
  if (code === 'XLM' || code === 'NATIVE' || !assetIssuer) {
    return 'XLM'
  }
  return `${code}:${assetIssuer.trim()}`
}

export function formatAccountTopic(network: string, accountId: string): string {
  return `account:${network.trim().toLowerCase()}:${accountId.trim()}`
}

/**
 * Manages live wallet balance and Stellar account state streaming with optimistic
 * transaction deductions, 404 unfunded-account handling, and network/wallet isolation.
 */
export class AccountBalanceStreamController {
  private readonly staleAfterMs: number
  private readonly now: () => number
  private readonly onSubscribeTopic?: (topic: string) => void
  private readonly onUnsubscribeTopic?: (topic: string) => void
  private readonly listeners = new Set<(state: AccountBalanceViewState) => void>()

  private state: AccountBalanceViewState
  private activeTopic: string | null = null
  private authoritativeBalances: Record<string, StellarAssetBalance> = {}
  private optimisticAdjustments = new Map<string, number>()

  constructor(options: AccountBalanceStreamOptions = {}) {
    this.staleAfterMs = options.staleAfterMs ?? 30_000
    this.now = options.now ?? (() => Date.now())
    this.onSubscribeTopic = options.onSubscribeTopic
    this.onUnsubscribeTopic = options.onUnsubscribeTopic

    const accountId = options.initialAccountId?.trim() || null
    const network = (options.initialNetwork ?? 'testnet').trim().toLowerCase()

    this.state = {
      accountId,
      network,
      balances: {},
      sequence: null,
      subentryCount: 0,
      updatedAt: null,
      isStale: false,
      isLoading: Boolean(accountId),
      isUnfunded: false,
      hasPendingOptimisticDelta: false,
    }

    if (accountId) {
      this.activeTopic = formatAccountTopic(network, accountId)
      this.onSubscribeTopic?.(this.activeTopic)
    }
  }

  public getState(): AccountBalanceViewState {
    if (this.state.updatedAt !== null) {
      const age = Math.max(0, this.now() - this.state.updatedAt)
      const isStale = age >= this.staleAfterMs
      if (isStale !== this.state.isStale) {
        this.state = { ...this.state, isStale }
      }
    }
    return this.state
  }

  public subscribe(
    listener: (state: AccountBalanceViewState) => void,
  ): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Switches the active wallet address and/or Stellar network, tearing down the
   * previous subscription and purging balances to prevent cross-network bleed.
   */
  public setScope(accountId: string | null, network?: string): void {
    const nextAccount = accountId?.trim() || null
    const nextNetwork = (network ?? this.state.network).trim().toLowerCase()

    if (
      nextAccount === this.state.accountId &&
      nextNetwork === this.state.network
    ) {
      return
    }

    if (this.activeTopic) {
      this.onUnsubscribeTopic?.(this.activeTopic)
      this.activeTopic = null
    }

    this.authoritativeBalances = {}
    this.optimisticAdjustments.clear()

    this.state = {
      accountId: nextAccount,
      network: nextNetwork,
      balances: {},
      sequence: null,
      subentryCount: 0,
      updatedAt: null,
      isStale: false,
      isLoading: Boolean(nextAccount),
      isUnfunded: false,
      hasPendingOptimisticDelta: false,
    }

    if (nextAccount) {
      this.activeTopic = formatAccountTopic(nextNetwork, nextAccount)
      this.onSubscribeTopic?.(this.activeTopic)
    }

    this.notify()
  }

  /**
   * Applies an authoritative push or REST snapshot and reconciles any pending
   * optimistic local balance deductions.
   */
  public applyAccountSnapshot(snapshot: StellarAccountSnapshot): boolean {
    if (
      snapshot.accountId.trim() !== this.state.accountId ||
      snapshot.network.trim().toLowerCase() !== this.state.network
    ) {
      return false
    }

    if (
      this.state.sequence !== null &&
      BigInt(snapshot.sequence) < BigInt(this.state.sequence)
    ) {
      return false
    }

    const nextAuth: Record<string, StellarAssetBalance> = {}
    for (const item of snapshot.balances) {
      const key = getAssetKey(item.assetCode, item.assetIssuer)
      nextAuth[key] = { ...item }
    }

    this.authoritativeBalances = nextAuth
    // Authoritative ledger close reconciles optimistic deltas
    this.optimisticAdjustments.clear()

    this.state = {
      accountId: this.state.accountId,
      network: this.state.network,
      balances: { ...nextAuth },
      sequence: snapshot.sequence,
      subentryCount: snapshot.subentryCount,
      updatedAt: snapshot.updatedAt ?? this.now(),
      isStale: false,
      isLoading: false,
      isUnfunded: false,
      hasPendingOptimisticDelta: false,
    }

    this.notify()
    return true
  }

  /**
   * Handles Horizon 404 (account not funded on ledger yet) as a valid zero-balance
   * state rather than surfacing an error toast.
   */
  public markAccountUnfunded(): void {
    if (!this.state.accountId) return
    const zeroXlm: StellarAssetBalance = {
      assetCode: 'XLM',
      balance: '0.0000000',
      decimals: 7,
    }
    this.authoritativeBalances = { XLM: zeroXlm }
    this.optimisticAdjustments.clear()

    this.state = {
      ...this.state,
      balances: { XLM: zeroXlm },
      sequence: '0',
      subentryCount: 0,
      updatedAt: this.now(),
      isStale: false,
      isLoading: false,
      isUnfunded: true,
      hasPendingOptimisticDelta: false,
    }
    this.notify()
  }

  /**
   * Optimistically adjusts an asset balance locally after a transaction submission
   * until the authoritative push event reconciles it.
   */
  public applyOptimisticDelta(assetKey: string, deltaAmount: number): void {
    const currentDelta = this.optimisticAdjustments.get(assetKey) ?? 0
    this.optimisticAdjustments.set(assetKey, currentDelta + deltaAmount)

    const merged: Record<string, StellarAssetBalance> = {
      ...this.authoritativeBalances,
    }

    for (const [key, adj] of this.optimisticAdjustments.entries()) {
      const base = merged[key]
      const baseNum = base ? Number.parseFloat(base.balance) : 0
      const decimals = base?.decimals ?? 7
      const updated = Math.max(0, baseNum + adj)
      merged[key] = {
        assetCode: base?.assetCode ?? key.split(':')[0],
        assetIssuer: base?.assetIssuer,
        balance: updated.toFixed(decimals),
        decimals,
      }
    }

    this.state = {
      ...this.state,
      balances: merged,
      hasPendingOptimisticDelta: true,
    }
    this.notify()
  }

  public dispose(): void {
    if (this.activeTopic) {
      this.onUnsubscribeTopic?.(this.activeTopic)
      this.activeTopic = null
    }
    this.listeners.clear()
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      listener(this.state)
    }
  }
}

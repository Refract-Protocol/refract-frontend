/**
 * Optimistic UI update reconciliation against authoritative realtime push
 * events (#255).
 *
 * Tracks pending optimistic actions (`cover_purchase`, `pool_deposit`,
 * `pool_withdraw`, `claim_submit`) by correlation/idempotency key and resolves
 * them into `confirm`, `amend`, `rollback`, or `timeout_verify` transitions.
 */

export type OptimisticActionKind =
  | 'cover_purchase'
  | 'pool_deposit'
  | 'pool_withdraw'
  | 'claim_submit'

export type ReconciliationResolution =
  | 'confirm'
  | 'amend'
  | 'rollback'
  | 'timeout_verify'
  | 'duplicate_ignored'

export interface OptimisticRollbackNotice {
  id: string
  correlationId: string
  actionKind: OptimisticActionKind
  title: string
  message: string
  dismissible: true
  createdAt: number
}

export interface PendingOptimisticAction<TState = Record<string, unknown>> {
  correlationId: string
  actionKind: OptimisticActionKind
  createdAt: number
  expiresAt: number
  previousState: TState
  optimisticState: TState
}

export interface AuthoritativeRealtimeOutcome<TState = Record<string, unknown>> {
  correlationId: string
  status: 'confirmed' | 'rejected' | 'failed'
  authoritativeState?: TState
  errorReason?: string
}

export interface ReconciliationResult<TState = Record<string, unknown>> {
  correlationId: string
  resolution: ReconciliationResolution
  nextState: TState
  amendedFields: string[]
  notice?: OptimisticRollbackNotice
}

export interface OptimisticReconcilerOptions<TState = Record<string, unknown>> {
  /** Default timeout in ms before an unresolved optimistic action triggers REST verification (default: 30,000ms). */
  timeoutMs?: number
  /** Clock provider for deterministic testing. */
  nowFn?: () => number
  /** Invoked whenever state should be updated in the store/cache. */
  onStateChange?: (correlationId: string, nextState: TState, resolution: ReconciliationResolution) => void
  /** Invoked when a rollback requires surfacing a dismissible user notice. */
  onRollbackNotice?: (notice: OptimisticRollbackNotice) => void
  /** Invoked when a pending optimistic action expires without receiving a realtime event. */
  onTimeoutVerify?: (action: PendingOptimisticAction<TState>) => void
}

export class OptimisticReconciler<
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  private readonly timeoutMs: number
  private readonly nowFn: () => number
  private readonly onStateChange?: (
    correlationId: string,
    nextState: TState,
    resolution: ReconciliationResolution
  ) => void
  private readonly onRollbackNotice?: (notice: OptimisticRollbackNotice) => void
  private readonly onTimeoutVerify?: (action: PendingOptimisticAction<TState>) => void

  private readonly pending = new Map<string, PendingOptimisticAction<TState>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly resolvedHistory = new Map<
    string,
    { resolution: ReconciliationResolution; finalState: TState }
  >()
  private readonly activeNotices = new Map<string, OptimisticRollbackNotice>()

  constructor(options: OptimisticReconcilerOptions<TState> = {}) {
    this.timeoutMs = Math.max(100, options.timeoutMs ?? 30_000)
    this.nowFn = options.nowFn ?? (() => Date.now())
    this.onStateChange = options.onStateChange
    this.onRollbackNotice = options.onRollbackNotice
    this.onTimeoutVerify = options.onTimeoutVerify
  }

  /**
   * Registers a new optimistic UI action and schedules its verification timeout.
   */
  beginOptimisticAction(params: {
    correlationId: string
    actionKind: OptimisticActionKind
    previousState: TState
    optimisticState: TState
    timeoutMs?: number
  }): PendingOptimisticAction<TState> {
    const now = this.nowFn()
    const ttl = params.timeoutMs ?? this.timeoutMs
    const entry: PendingOptimisticAction<TState> = {
      correlationId: params.correlationId,
      actionKind: params.actionKind,
      createdAt: now,
      expiresAt: now + ttl,
      previousState: { ...params.previousState },
      optimisticState: { ...params.optimisticState },
    }

    this.clearTimer(params.correlationId)
    this.pending.set(params.correlationId, entry)
    this.onStateChange?.(params.correlationId, entry.optimisticState, 'confirm')

    const timer = setTimeout(() => {
      this.timers.delete(params.correlationId)
      const current = this.pending.get(params.correlationId)
      if (!current) return
      this.pending.delete(params.correlationId)
      this.resolvedHistory.set(params.correlationId, {
        resolution: 'timeout_verify',
        finalState: current.optimisticState,
      })
      this.onTimeoutVerify?.(current)
    }, ttl)

    this.timers.set(params.correlationId, timer)
    return entry
  }

  /**
   * Reconciles an inbound authoritative realtime outcome against any pending
   * or previously resolved optimistic action.
   */
  reconcile(outcome: AuthoritativeRealtimeOutcome<TState>): ReconciliationResult<TState> | null {
    const existingResolved = this.resolvedHistory.get(outcome.correlationId)
    if (existingResolved) {
      return {
        correlationId: outcome.correlationId,
        resolution: 'duplicate_ignored',
        nextState: existingResolved.finalState,
        amendedFields: [],
      }
    }

    const action = this.pending.get(outcome.correlationId)
    if (!action) {
      return null
    }

    this.clearTimer(outcome.correlationId)
    this.pending.delete(outcome.correlationId)

    // Adverse outcome -> Rollback to pre-action state and emit dismissible notice
    if (outcome.status === 'rejected' || outcome.status === 'failed') {
      const restored = { ...action.previousState }
      const notice = this.buildRollbackNotice(action, outcome.errorReason)
      this.activeNotices.set(notice.id, notice)
      this.resolvedHistory.set(outcome.correlationId, {
        resolution: 'rollback',
        finalState: restored,
      })
      this.onStateChange?.(outcome.correlationId, restored, 'rollback')
      this.onRollbackNotice?.(notice)

      return {
        correlationId: outcome.correlationId,
        resolution: 'rollback',
        nextState: restored,
        amendedFields: [],
        notice,
      }
    }

    // Confirmed outcome -> check whether authoritative fields match or amend the optimistic guess
    const authoritative = outcome.authoritativeState
      ? { ...action.optimisticState, ...outcome.authoritativeState }
      : { ...action.optimisticState }

    const amendedFields = this.diffFields(action.optimisticState, authoritative)
    const resolution: ReconciliationResolution =
      amendedFields.length > 0 ? 'amend' : 'confirm'

    this.resolvedHistory.set(outcome.correlationId, {
      resolution,
      finalState: authoritative,
    })
    this.onStateChange?.(outcome.correlationId, authoritative, resolution)

    return {
      correlationId: outcome.correlationId,
      resolution,
      nextState: authoritative,
      amendedFields,
    }
  }

  dismissNotice(noticeId: string): boolean {
    return this.activeNotices.delete(noticeId)
  }

  getActiveNotices(): OptimisticRollbackNotice[] {
    return Array.from(this.activeNotices.values())
  }

  getPendingCount(): number {
    return this.pending.size
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.pending.clear()
  }

  private diffFields(optimistic: TState, authoritative: TState): string[] {
    const keys = new Set([
      ...Object.keys(optimistic),
      ...Object.keys(authoritative),
    ])
    const changed: string[] = []
    for (const key of keys) {
      if (optimistic[key] !== authoritative[key]) {
        changed.push(key)
      }
    }
    return changed.sort()
  }

  private buildRollbackNotice(
    action: PendingOptimisticAction<TState>,
    errorReason?: string
  ): OptimisticRollbackNotice {
    const labelMap: Record<OptimisticActionKind, string> = {
      cover_purchase: 'Cover purchase',
      pool_deposit: 'Capital deposit',
      pool_withdraw: 'Capital withdrawal',
      claim_submit: 'Claim submission',
    }
    const label = labelMap[action.actionKind]
    return {
      id: `notice:${action.correlationId}`,
      correlationId: action.correlationId,
      actionKind: action.actionKind,
      title: `${label} rolled back`,
      message: errorReason
        ? `${label} could not be confirmed: ${errorReason}. Your previous state has been restored.`
        : `${label} was rejected by the network. Your previous state has been restored.`,
      dismissible: true,
      createdAt: this.nowFn(),
    }
  }

  private clearTimer(correlationId: string): void {
    const timer = this.timers.get(correlationId)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.timers.delete(correlationId)
    }
  }
}

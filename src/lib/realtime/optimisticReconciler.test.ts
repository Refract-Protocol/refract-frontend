import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  OptimisticReconciler,
  type OptimisticRollbackNotice,
} from './optimisticReconciler'

describe('OptimisticReconciler (#255)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reconciles confirm and field-level amend outcomes and ignores replayed duplicate events', () => {
    const reconciler = new OptimisticReconciler<{
      depositedUsdc: number
      lpShares: number
    }>()

    // 1. Exact confirmation on cover purchase / deposit
    reconciler.beginOptimisticAction({
      correlationId: 'corr-confirm-1',
      actionKind: 'pool_deposit',
      previousState: { depositedUsdc: 1000, lpShares: 1000 },
      optimisticState: { depositedUsdc: 1500, lpShares: 1500 },
    })

    const confirmRes = reconciler.reconcile({
      correlationId: 'corr-confirm-1',
      status: 'confirmed',
      authoritativeState: { depositedUsdc: 1500, lpShares: 1500 },
    })
    expect(confirmRes?.resolution).toBe('confirm')
    expect(confirmRes?.amendedFields).toEqual([])

    // Replayed confirmation event for the same correlationId is ignored idempotently
    const replayRes = reconciler.reconcile({
      correlationId: 'corr-confirm-1',
      status: 'confirmed',
      authoritativeState: { depositedUsdc: 1500, lpShares: 1500 },
    })
    expect(replayRes?.resolution).toBe('duplicate_ignored')

    // 2. Field-level amendment (authoritative LP shares slightly lower due to pool fee/slippage)
    reconciler.beginOptimisticAction({
      correlationId: 'corr-amend-2',
      actionKind: 'pool_deposit',
      previousState: { depositedUsdc: 1500, lpShares: 1500 },
      optimisticState: { depositedUsdc: 2000, lpShares: 2000 },
    })

    const amendRes = reconciler.reconcile({
      correlationId: 'corr-amend-2',
      status: 'confirmed',
      authoritativeState: { depositedUsdc: 2000, lpShares: 1995 },
    })
    expect(amendRes?.resolution).toBe('amend')
    expect(amendRes?.amendedFields).toEqual(['lpShares'])
    expect(amendRes?.nextState).toEqual({ depositedUsdc: 2000, lpShares: 1995 })
  })

  it('rolls back to pre-action state on rejection, surfaces a dismissible notice, and stays idempotent on duplicate adverse events', () => {
    const notices: OptimisticRollbackNotice[] = []
    let renderedBalance = 5000
    let renderedPolicies = 1

    const reconciler = new OptimisticReconciler<{
      usdcBalance: number
      activePolicies: number
    }>({
      onStateChange: (_id, state) => {
        renderedBalance = state.usdcBalance
        renderedPolicies = state.activePolicies
      },
      onRollbackNotice: (notice) => notices.push(notice),
    })

    // User clicks "Buy Cover": UI optimistically deducts 200 USDC and increments activePolicies
    reconciler.beginOptimisticAction({
      correlationId: 'corr-cover-reject',
      actionKind: 'cover_purchase',
      previousState: { usdcBalance: 5000, activePolicies: 1 },
      optimisticState: { usdcBalance: 4800, activePolicies: 2 },
    })
    expect(renderedBalance).toBe(4800)
    expect(renderedPolicies).toBe(2)

    // Authoritative push event reports Soroban slippage/capacity rejection
    const rollbackRes = reconciler.reconcile({
      correlationId: 'corr-cover-reject',
      status: 'rejected',
      errorReason: 'Pool capacity exceeded',
    })

    expect(rollbackRes?.resolution).toBe('rollback')
    expect(renderedBalance).toBe(5000)
    expect(renderedPolicies).toBe(1)
    expect(notices).toHaveLength(1)
    expect(notices[0].dismissible).toBe(true)
    expect(notices[0].message).toContain('Pool capacity exceeded')

    // Second conflicting/duplicate rejection event does not emit a duplicate notice
    const dupRollback = reconciler.reconcile({
      correlationId: 'corr-cover-reject',
      status: 'failed',
    })
    expect(dupRollback?.resolution).toBe('duplicate_ignored')
    expect(notices).toHaveLength(1)

    // User dismisses notice
    expect(reconciler.dismissNotice(notices[0].id)).toBe(true)
    expect(reconciler.getActiveNotices()).toHaveLength(0)
  })

  it('expires pending actions on timeout and triggers REST verification fallback', async () => {
    const timedOutIds: string[] = []
    const reconciler = new OptimisticReconciler({
      timeoutMs: 5_000,
      onTimeoutVerify: (action) => timedOutIds.push(action.correlationId),
    })

    reconciler.beginOptimisticAction({
      correlationId: 'corr-timeout-99',
      actionKind: 'claim_submit',
      previousState: { pendingClaims: 0 },
      optimisticState: { pendingClaims: 1 },
    })

    expect(reconciler.getPendingCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(reconciler.getPendingCount()).toBe(0)
    expect(timedOutIds).toEqual(['corr-timeout-99'])
  })
})

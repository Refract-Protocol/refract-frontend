export interface CoverageQuotePayload {
  riskClass: string
  durationDays: number
  coverageAmountUsd: number
  premiumUsd: number
  annualRateBps: number
  coverageLimitUsd: number
  expiresAt: number
  updatedAt: number
  sequence?: number
}

export type PurchaseFlowPhase = 'editing' | 'confirming' | 'submitting'

export interface CoverageQuoteViewState {
  activeTopic: string | null
  flowPhase: PurchaseFlowPhase
  quote: CoverageQuotePayload | null
  source: 'rest_seed' | 'realtime' | 'none'
  updatedJustNow: boolean
  isStale: boolean
  requiresReconfirm: boolean
  confirmedPremiumUsd: number | null
}

export interface CoverageQuotesStreamOptions {
  scheduleFrame?: (cb: () => void) => () => void
  onSubscribeTopic?: (topic: string) => void
  onUnsubscribeTopic?: (topic: string) => void
  now?: () => number
}

export function formatCoverageQuoteTopic(
  riskClass: string,
  durationDays: number,
): string {
  return `quotes:${riskClass.trim().toLowerCase()}:${durationDays}d`
}

/**
 * Streams live coverage quotes and premium pricing into the `/cover` purchase flow
 * with animation-frame coalescing, parameter-change re-subscription, and a
 * price-change re-confirmation gate during the confirm step.
 */
export class CoverageQuotesStreamController {
  private readonly scheduleFrame: (cb: () => void) => () => void
  private readonly onSubscribeTopic?: (topic: string) => void
  private readonly onUnsubscribeTopic?: (topic: string) => void
  private readonly now: () => number
  private readonly listeners = new Set<(state: CoverageQuoteViewState) => void>()

  private state: CoverageQuoteViewState = {
    activeTopic: null,
    flowPhase: 'editing',
    quote: null,
    source: 'none',
    updatedJustNow: false,
    isStale: false,
    requiresReconfirm: false,
    confirmedPremiumUsd: null,
  }

  private pendingQuote: CoverageQuotePayload | null = null
  private cancelFrame: (() => void) | null = null

  constructor(options: CoverageQuotesStreamOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.onSubscribeTopic = options.onSubscribeTopic
    this.onUnsubscribeTopic = options.onUnsubscribeTopic
    this.scheduleFrame =
      options.scheduleFrame ??
      ((cb) => {
        const id = setTimeout(cb, 16)
        return () => clearTimeout(id)
      })
  }

  public getState(): CoverageQuoteViewState {
    return this.state
  }

  public subscribe(
    listener: (state: CoverageQuoteViewState) => void,
  ): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Updates selected risk class and duration, tearing down any previous topic
   * subscription and subscribing to the new quote topic.
   */
  public selectQuoteParameters(
    riskClass: string,
    durationDays: number,
  ): string {
    const nextTopic = formatCoverageQuoteTopic(riskClass, durationDays)
    if (this.state.activeTopic === nextTopic) {
      return nextTopic
    }

    if (this.state.activeTopic) {
      this.onUnsubscribeTopic?.(this.state.activeTopic)
    }
    this.clearPendingFrame()

    this.state = {
      activeTopic: nextTopic,
      flowPhase: 'editing',
      quote: null,
      source: 'none',
      updatedJustNow: false,
      isStale: false,
      requiresReconfirm: false,
      confirmedPremiumUsd: null,
    }

    this.onSubscribeTopic?.(nextTopic)
    this.notify()
    return nextTopic
  }

  public applyRestQuote(quote: CoverageQuotePayload, isStale = false): void {
    if (this.state.flowPhase === 'submitting') {
      return
    }
    this.state = {
      ...this.state,
      quote: { ...quote },
      source: 'rest_seed',
      updatedJustNow: false,
      isStale,
    }
    this.notify()
  }

  /**
   * Queues a pushed realtime quote and coalesces rapid updates within the same
   * animation frame. Ignored once the user has clicked final submit (`submitting`).
   */
  public pushRealtimeQuote(quote: CoverageQuotePayload): void {
    if (this.state.flowPhase === 'submitting') {
      return
    }

    const expectedTopic = formatCoverageQuoteTopic(
      quote.riskClass,
      quote.durationDays,
    )
    if (this.state.activeTopic && expectedTopic !== this.state.activeTopic) {
      return
    }

    this.pendingQuote = { ...quote }
    if (this.cancelFrame !== null) {
      return
    }

    this.cancelFrame = this.scheduleFrame(() => {
      this.cancelFrame = null
      this.flushPendingQuote()
    })
  }

  /**
   * Enters the confirmation step, locking in the currently displayed premium.
   */
  public startConfirmStep(): void {
    if (!this.state.quote) {
      throw new Error('Cannot start confirm step without an active quote')
    }
    this.state = {
      ...this.state,
      flowPhase: 'confirming',
      confirmedPremiumUsd: this.state.quote.premiumUsd,
      requiresReconfirm: false,
    }
    this.notify()
  }

  /**
   * Explicitly acknowledges a pushed premium change during the confirm step.
   */
  public acknowledgePriceChange(): void {
    if (!this.state.quote) return
    this.state = {
      ...this.state,
      confirmedPremiumUsd: this.state.quote.premiumUsd,
      requiresReconfirm: false,
    }
    this.notify()
  }

  /**
   * Transitions to `'submitting'` if no unacknowledged price change is pending.
   * Once in `'submitting'`, further pushes are discarded.
   */
  public beginSubmitTransaction(): {
    allowed: boolean
    reason?: 'reconfirm_required' | 'missing_quote'
    submittedQuote?: CoverageQuotePayload
  } {
    if (!this.state.quote) {
      return { allowed: false, reason: 'missing_quote' }
    }
    if (this.state.requiresReconfirm) {
      return { allowed: false, reason: 'reconfirm_required' }
    }

    this.clearPendingFrame()
    this.state = {
      ...this.state,
      flowPhase: 'submitting',
    }
    this.notify()
    return {
      allowed: true,
      submittedQuote: { ...this.state.quote },
    }
  }

  public dispose(): void {
    this.clearPendingFrame()
    if (this.state.activeTopic) {
      this.onUnsubscribeTopic?.(this.state.activeTopic)
      this.state = { ...this.state, activeTopic: null }
    }
    this.listeners.clear()
  }

  private flushPendingQuote(): void {
    if (!this.pendingQuote || this.state.flowPhase === 'submitting') {
      this.pendingQuote = null
      return
    }

    const incoming = this.pendingQuote
    this.pendingQuote = null

    if (
      this.state.quote?.sequence !== undefined &&
      incoming.sequence !== undefined &&
      incoming.sequence < this.state.quote.sequence
    ) {
      return
    }

    const premiumChangedDuringConfirm =
      this.state.flowPhase === 'confirming' &&
      this.state.confirmedPremiumUsd !== null &&
      incoming.premiumUsd !== this.state.confirmedPremiumUsd

    this.state = {
      ...this.state,
      quote: incoming,
      source: 'realtime',
      updatedJustNow: true,
      isStale: false,
      requiresReconfirm:
        this.state.requiresReconfirm || premiumChangedDuringConfirm,
    }
    this.notify()
  }

  private clearPendingFrame(): void {
    if (this.cancelFrame) {
      this.cancelFrame()
      this.cancelFrame = null
    }
    this.pendingQuote = null
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      listener(this.state)
    }
  }
}

/**
 * Page lifecycle, bfcache, and freeze/resume teardown coordinator for the
 * realtime layer (#272).
 *
 * Translates `pagehide`, `pageshow`, `freeze`, `resume`, and `visibilitychange`
 * signals into deterministic client commands: flushing pending state,
 * relinquishing cross-tab leadership, closing the socket without zombie leaks,
 * and forcing a fresh resync on bfcache restore.
 */

export type PageLifecyclePhase =
  | 'active'
  | 'hidden'
  | 'freezing'
  | 'frozen'
  | 'bfcache'
  | 'terminated'

export interface RealtimeLifecycleCallbacks {
  /** Synchronously flushes any pending outbound mutations or persisted cursors. */
  flushPendingState: () => void
  /** Relinquishes the cross-tab leader role so a follower tab can promote immediately. */
  relinquishLeadership: () => void
  /** Re-enters cross-tab leader/follower election after bfcache or freeze restore. */
  rejoinLeadership?: () => void
  /** Closes the active WebSocket/SSE connection cleanly. */
  closeConnection: (reason: string) => void
  /** Forces a fresh connection and snapshot resync after bfcache restore or long freeze. */
  reconnectAndResync: (reason: string) => void
  /** Marks rendered realtime state as stale during freeze/bfcache until resync completes. */
  setStaleFromLifecycle?: (isStale: boolean) => void
  /** Notifies visibility-based pause/resume without conflicting with full teardown. */
  onVisibilityPausedChange?: (paused: boolean) => void
}

export interface PageLifecycleCoordinatorOptions {
  callbacks: RealtimeLifecycleCallbacks
  /**
   * Grace period in milliseconds before a `freeze` event closes the socket and
   * relinquishes leadership, avoiding churn on sub-second tab freezes (default: 1,500ms).
   */
  freezeGraceMs?: number
}

export class RealtimePageLifecycleCoordinator {
  private readonly callbacks: RealtimeLifecycleCallbacks
  private readonly freezeGraceMs: number

  private phase: PageLifecyclePhase = 'active'
  private connectionClosedByLifecycle = false
  private staleFromLifecycle = false
  private freezeTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: PageLifecycleCoordinatorOptions) {
    this.callbacks = options.callbacks
    this.freezeGraceMs = Math.max(0, options.freezeGraceMs ?? 1_500)
  }

  /**
   * Handles the browser `pagehide` event (both bfcache entry `persisted=true`
   * and final tab unload `persisted=false`).
   */
  handlePageHide(event: { persisted?: boolean } = {}): void {
    this.clearFreezeTimer()
    const persisted = event.persisted === true
    this.phase = persisted ? 'bfcache' : 'terminated'

    if (persisted) {
      this.setStale(true)
    }

    this.teardownConnectionOnce(persisted ? 'bfcache_entry' : 'page_unload')
  }

  /**
   * Handles the browser `pageshow` event. When restored from bfcache
   * (`persisted=true`) or after a lifecycle teardown, forces a fresh connection
   * and resync so pre-freeze data is never treated as live.
   */
  handlePageShow(event: { persisted?: boolean } = {}): void {
    this.clearFreezeTimer()
    const restoredFromBfcache =
      event.persisted === true || this.phase === 'bfcache'

    this.phase = 'active'

    if (restoredFromBfcache || this.connectionClosedByLifecycle) {
      this.setStale(true)
      this.connectionClosedByLifecycle = false
      this.callbacks.rejoinLeadership?.()
      this.callbacks.reconnectAndResync('bfcache_restore')
    }
  }

  /**
   * Handles the Page Lifecycle API `freeze` event.
   * Flushes pending state immediately, marks data stale, and schedules socket
   * close + leadership handover after `freezeGraceMs` so brief freezes followed
   * immediately by `resume` do not churn connections.
   */
  handleFreeze(): void {
    if (this.phase === 'bfcache' || this.phase === 'terminated') {
      return
    }
    this.clearFreezeTimer()
    this.phase = 'freezing'
    this.setStale(true)
    this.callbacks.flushPendingState()

    if (this.freezeGraceMs === 0) {
      this.phase = 'frozen'
      this.teardownConnectionOnce('page_freeze')
      return
    }

    this.freezeTimer = setTimeout(() => {
      this.freezeTimer = null
      if (this.phase === 'freezing') {
        this.phase = 'frozen'
        this.teardownConnectionOnce('page_freeze')
      }
    }, this.freezeGraceMs)
  }

  /**
   * Handles the Page Lifecycle API `resume` event.
   */
  handleResume(): void {
    const wasFullFrozen = this.phase === 'frozen' || this.connectionClosedByLifecycle
    this.clearFreezeTimer()
    this.phase = 'active'

    if (wasFullFrozen) {
      this.connectionClosedByLifecycle = false
      this.callbacks.rejoinLeadership?.()
      this.callbacks.reconnectAndResync('page_resume')
    } else {
      // Resumed within grace window before socket was torn down
      this.setStale(false)
    }
  }

  /**
   * Handles `visibilitychange` while reconciling with `pagehide` / `freeze` so
   * visibility pause never fights a full teardown.
   */
  handleVisibilityChange(visibilityState: 'visible' | 'hidden'): void {
    if (
      this.phase === 'bfcache' ||
      this.phase === 'terminated' ||
      this.phase === 'frozen' ||
      this.phase === 'freezing'
    ) {
      return
    }

    if (visibilityState === 'hidden') {
      this.phase = 'hidden'
      this.callbacks.flushPendingState()
      this.callbacks.onVisibilityPausedChange?.(true)
    } else {
      this.phase = 'active'
      this.callbacks.onVisibilityPausedChange?.(false)
    }
  }

  /**
   * Marks the post-restore resync complete so live data can be rendered again.
   */
  markResyncComplete(): void {
    this.setStale(false)
  }

  isStaleFromLifecycle(): boolean {
    return this.staleFromLifecycle
  }

  getPhase(): PageLifecyclePhase {
    return this.phase
  }

  dispose(): void {
    this.clearFreezeTimer()
  }

  private teardownConnectionOnce(reason: string): void {
    this.callbacks.flushPendingState()
    if (this.connectionClosedByLifecycle) {
      return
    }
    this.connectionClosedByLifecycle = true
    this.callbacks.relinquishLeadership()
    this.callbacks.closeConnection(reason)
  }

  private setStale(stale: boolean): void {
    if (this.staleFromLifecycle === stale) return
    this.staleFromLifecycle = stale
    this.callbacks.setStaleFromLifecycle?.(stale)
  }

  private clearFreezeTimer(): void {
    if (this.freezeTimer !== null) {
      clearTimeout(this.freezeTimer)
      this.freezeTimer = null
    }
  }
}

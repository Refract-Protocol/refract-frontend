export type NotificationPriority = 'critical' | 'high' | 'normal' | 'low'

export interface RealtimeNotificationItem {
  id: string
  title: string
  body?: string
  priority: NotificationPriority
  category: 'settlement' | 'claim' | 'policy' | 'pool' | 'general'
  timestamp: number
  source?: 'realtime' | 'rest'
}

export interface VisibleToastEntry {
  id: string
  title: string
  body?: string
  priority: NotificationPriority
  category: RealtimeNotificationItem['category']
  timestamp: number
  isSummary: boolean
  collapsedItems: RealtimeNotificationItem[]
  summaryLabel?: string
}

export interface QuietHoursPreference {
  enabled: boolean
  /** Start hour in 24h local time [0..23] */
  startHour?: number
  /** End hour in 24h local time [0..23] */
  endHour?: number
}

export interface RealtimeToastLimiterOptions {
  maxVisibleToasts?: number
  maxToastsPerWindow?: number
  windowMs?: number
  quietHours?: QuietHoursPreference
  now?: () => number
  getCurrentHour?: () => number
}

const PRIORITY_SCORE: Record<NotificationPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
}

export function isWithinQuietHours(
  pref: QuietHoursPreference | undefined,
  currentHour: number,
): boolean {
  if (!pref || !pref.enabled) return false
  if (pref.startHour === undefined || pref.endHour === undefined) {
    return true
  }
  const start = ((pref.startHour % 24) + 24) % 24
  const end = ((pref.endHour % 24) + 24) % 24
  if (start === end) return true
  if (start < end) {
    return currentHour >= start && currentHour < end
  }
  // Wraps midnight (e.g. 22:00 -> 07:00)
  return currentHour >= start || currentHour < end
}

/**
 * Rate-limits, prioritizes, deduplicates, and applies quiet-hours deferral to
 * realtime toast notifications while coalescing bursts into an expandable summary toast.
 */
export class RealtimeToastLimiter {
  private readonly maxVisibleToasts: number
  private readonly maxToastsPerWindow: number
  private readonly windowMs: number
  private readonly now: () => number
  private readonly getCurrentHour: () => number

  private quietHours: QuietHoursPreference
  private readonly seenIds = new Set<string>()
  private readonly recentToastTimestamps: number[] = []
  private readonly visibleToasts: VisibleToastEntry[] = []
  private readonly overflowItems: RealtimeNotificationItem[] = []
  private readonly deferredItems: RealtimeNotificationItem[] = []

  constructor(options: RealtimeToastLimiterOptions = {}) {
    this.maxVisibleToasts = Math.max(1, options.maxVisibleToasts ?? 3)
    this.maxToastsPerWindow = Math.max(1, options.maxToastsPerWindow ?? 3)
    this.windowMs = Math.max(100, options.windowMs ?? 10_000)
    this.quietHours = options.quietHours ?? { enabled: false }
    this.now = options.now ?? (() => Date.now())
    this.getCurrentHour =
      options.getCurrentHour ?? (() => new Date(this.now()).getHours())
  }

  public setQuietHours(pref: QuietHoursPreference): void {
    this.quietHours = { ...pref }
  }

  /**
   * Ingests a notification from realtime or REST fallback.
   * Returns `'shown' | 'coalesced' | 'deferred' | 'duplicate'`.
   */
  public ingest(
    item: RealtimeNotificationItem,
  ): 'shown' | 'coalesced' | 'deferred' | 'duplicate' {
    const cleanId = item.id.trim()
    if (this.seenIds.has(cleanId)) {
      return 'duplicate'
    }
    this.seenIds.add(cleanId)

    const isCritical =
      item.priority === 'critical' || item.category === 'settlement'

    // Quiet-hours deferral for non-critical notifications
    if (
      !isCritical &&
      isWithinQuietHours(this.quietHours, this.getCurrentHour())
    ) {
      this.deferredItems.push({ ...item })
      return 'deferred'
    }

    const currentTime = this.now()
    this.pruneWindow(currentTime)

    const rateExceeded =
      this.recentToastTimestamps.length >= this.maxToastsPerWindow
    const nonSummaryVisible = this.visibleToasts.filter((t) => !t.isSummary)
    const capacityFull = nonSummaryVisible.length >= this.maxVisibleToasts

    if (isCritical) {
      if (capacityFull) {
        // Evict lowest-priority non-critical visible toast into overflow summary if possible
        const evictIndex = this.findLowestPriorityEvictionIndex()
        if (evictIndex !== -1) {
          const [evicted] = this.visibleToasts.splice(evictIndex, 1)
          this.addToOverflow({
            id: evicted.id,
            title: evicted.title,
            body: evicted.body,
            priority: evicted.priority,
            category: evicted.category,
            timestamp: evicted.timestamp,
          })
        }
      }

      this.visibleToasts.unshift({
        id: item.id,
        title: item.title,
        body: item.body,
        priority: item.priority,
        category: item.category,
        timestamp: item.timestamp,
        isSummary: false,
        collapsedItems: [],
      })
      this.recentToastTimestamps.push(currentTime)
      return 'shown'
    }

    if (rateExceeded || capacityFull) {
      this.addToOverflow(item)
      return 'coalesced'
    }

    this.visibleToasts.push({
      id: item.id,
      title: item.title,
      body: item.body,
      priority: item.priority,
      category: item.category,
      timestamp: item.timestamp,
      isSummary: false,
      collapsedItems: [],
    })
    this.recentToastTimestamps.push(currentTime)
    return 'shown'
  }

  public getVisibleToasts(): VisibleToastEntry[] {
    return this.visibleToasts.map((t) => ({
      ...t,
      collapsedItems: [...t.collapsedItems],
    }))
  }

  public getDeferredNotifications(): RealtimeNotificationItem[] {
    return [...this.deferredItems]
  }

  public flushDeferredToOverflow(): RealtimeNotificationItem[] {
    const flushed = this.deferredItems.splice(0, this.deferredItems.length)
    for (const item of flushed) {
      this.addToOverflow(item)
    }
    return flushed
  }

  public dismissToast(id: string): void {
    const idx = this.visibleToasts.findIndex((t) => t.id === id)
    if (idx !== -1) {
      const removed = this.visibleToasts[idx]
      this.visibleToasts.splice(idx, 1)
      if (removed.isSummary) {
        this.overflowItems.length = 0
      }
    }
  }

  public resetOnAccountSwitch(): void {
    this.seenIds.clear()
    this.recentToastTimestamps.length = 0
    this.visibleToasts.length = 0
    this.overflowItems.length = 0
    this.deferredItems.length = 0
  }

  private addToOverflow(item: RealtimeNotificationItem): void {
    this.overflowItems.push({ ...item })
    const count = this.overflowItems.length
    const summaryLabel = `+${count} more notification${count === 1 ? '' : 's'}`

    const existingSummary = this.visibleToasts.find((t) => t.isSummary)
    if (existingSummary) {
      existingSummary.title = summaryLabel
      existingSummary.summaryLabel = summaryLabel
      existingSummary.timestamp = this.now()
      existingSummary.collapsedItems = [...this.overflowItems]
    } else {
      this.visibleToasts.push({
        id: 'summary:overflow',
        title: summaryLabel,
        summaryLabel,
        priority: 'normal',
        category: 'general',
        timestamp: this.now(),
        isSummary: true,
        collapsedItems: [...this.overflowItems],
      })
    }
  }

  private findLowestPriorityEvictionIndex(): number {
    let bestIdx = -1
    let lowestScore = Infinity
    for (let i = 0; i < this.visibleToasts.length; i += 1) {
      const entry = this.visibleToasts[i]
      if (entry.isSummary) continue
      const score = PRIORITY_SCORE[entry.priority]
      if (score < PRIORITY_SCORE.critical && score <= lowestScore) {
        lowestScore = score
        bestIdx = i
      }
    }
    return bestIdx
  }

  private pruneWindow(currentTime: number): void {
    while (
      this.recentToastTimestamps.length > 0 &&
      currentTime - this.recentToastTimestamps[0] >= this.windowMs
    ) {
      this.recentToastTimestamps.shift()
    }
  }
}

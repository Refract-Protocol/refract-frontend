export interface RouteTopicDefinition {
  routePattern: string
  topics: string[]
}

export const DEFAULT_ROUTE_TOPIC_MAP: readonly RouteTopicDefinition[] = [
  {
    routePattern: '/',
    topics: ['oracle_update', 'claims:recent', 'protocol:stats'],
  },
  {
    routePattern: '/cover',
    topics: ['oracle_update', 'policies:quotes', 'protocol:parameters'],
  },
  {
    routePattern: '/provide',
    topics: ['pool:liquidity', 'pool:activity', 'protocol:parameters'],
  },
  {
    routePattern: '/claims',
    topics: ['claims:updates', 'claims:recent'],
  },
  {
    routePattern: '/dashboard',
    topics: ['claims:updates', 'policies:updates', 'account:balance'],
  },
] as const

export interface RouteTopicNavigationOptions {
  routeMap?: readonly RouteTopicDefinition[]
  /** Grace window in ms to prevent subscribe/unsubscribe thrash on rapid back/forward navigation (default: 0 for synchronous mode, configurable e.g. 250ms) */
  drainGraceMs?: number
  /** TTL in ms for hover/focus route prefetch before releasing if user does not navigate (default: 10000ms) */
  prefetchTtlMs?: number
  onSubscribeTopic?: (topic: string) => void
  onUnsubscribeTopic?: (topic: string) => void
}

export function normalizePathname(pathname: string): string {
  const clean = pathname.trim().split('?')[0].split('#')[0]
  if (!clean || clean === '/') return '/'
  const withLeading = clean.startsWith('/') ? clean : `/${clean}`
  return withLeading.endsWith('/') ? withLeading.slice(0, -1) : withLeading
}

/**
 * Resolves the required realtime topics for a given App Router pathname.
 * Returns `[]` for unmapped routes so hook-driven subscriptions continue to work without error.
 */
export function resolveTopicsForRoute(
  pathname: string,
  routeMap: readonly RouteTopicDefinition[] = DEFAULT_ROUTE_TOPIC_MAP,
): string[] {
  const normalized = normalizePathname(pathname)

  for (const entry of routeMap) {
    const pattern = normalizePathname(entry.routePattern)
    if (pattern === '/') {
      if (normalized === '/') {
        return [...entry.topics]
      }
      continue
    }
    if (normalized === pattern || normalized.startsWith(`${pattern}/`)) {
      return [...entry.topics]
    }
  }

  return []
}

/**
 * Reference-counted route-to-topic subscription coordinator with link-intent
 * prefetching and rapid-navigation drain protection.
 */
export class RouteTopicNavigationManager {
  private readonly routeMap: readonly RouteTopicDefinition[]
  private readonly drainGraceMs: number
  private readonly prefetchTtlMs: number
  private readonly onSubscribeTopic?: (topic: string) => void
  private readonly onUnsubscribeTopic?: (topic: string) => void

  private currentRouteTopics = new Set<string>()
  private readonly refCounts = new Map<string, number>()
  private readonly pendingDrainTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()
  private readonly prefetchTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()
  private readonly prefetchedTopicsByRoute = new Map<string, string[]>()

  constructor(options: RouteTopicNavigationOptions = {}) {
    this.routeMap = options.routeMap ?? DEFAULT_ROUTE_TOPIC_MAP
    this.drainGraceMs = options.drainGraceMs ?? 0
    this.prefetchTtlMs = options.prefetchTtlMs ?? 10_000
    this.onSubscribeTopic = options.onSubscribeTopic
    this.onUnsubscribeTopic = options.onUnsubscribeTopic
  }

  /**
   * Transitions active route subscriptions to `nextPathname`, preserving shared
   * topics without unsubscribe/resubscribe churn.
   */
  public navigateTo(nextPathname: string): string[] {
    const normalizedRoute = normalizePathname(nextPathname)
    const nextTopics = new Set(
      resolveTopicsForRoute(normalizedRoute, this.routeMap),
    )

    // Increment refs for newly entered route topics first so shared topics never drop to 0
    for (const topic of nextTopics) {
      if (!this.currentRouteTopics.has(topic)) {
        this.retainTopic(topic)
      }
    }

    // Release any active prefetch for this route now that navigation has committed
    this.clearRoutePrefetch(normalizedRoute)

    // Decrement refs for topics no longer needed by the previous route
    for (const prevTopic of this.currentRouteTopics) {
      if (!nextTopics.has(prevTopic)) {
        this.releaseTopic(prevTopic)
      }
    }

    this.currentRouteTopics = nextTopics
    return this.getActiveTopics()
  }

  /**
   * Warms topics for `targetPathname` on link hover/focus without rendering data,
   * automatically releasing the prefetch reference if navigation does not occur within `prefetchTtlMs`.
   */
  public prefetchRoute(targetPathname: string): string[] {
    const normalizedRoute = normalizePathname(targetPathname)
    if (this.prefetchedTopicsByRoute.has(normalizedRoute)) {
      return this.prefetchedTopicsByRoute.get(normalizedRoute)!
    }

    const topics = resolveTopicsForRoute(normalizedRoute, this.routeMap)
    if (topics.length === 0) {
      return []
    }

    this.prefetchedTopicsByRoute.set(normalizedRoute, topics)
    for (const topic of topics) {
      this.retainTopic(topic)
    }

    const timer = setTimeout(() => {
      this.prefetchTimers.delete(normalizedRoute)
      this.clearRoutePrefetch(normalizedRoute)
    }, this.prefetchTtlMs)

    this.prefetchTimers.set(normalizedRoute, timer)
    return topics
  }

  /**
   * Acquires a manual hook-level reference for `topic` (used by unmapped routes or ad-hoc hooks).
   */
  public acquireHookTopic(topic: string): () => void {
    const normalized = topic.trim()
    this.retainTopic(normalized)
    let released = false
    return () => {
      if (released) return
      released = true
      this.releaseTopic(normalized)
    }
  }

  public getActiveTopics(): string[] {
    return Array.from(this.refCounts.keys())
  }

  public getRefCount(topic: string): number {
    return this.refCounts.get(topic.trim()) ?? 0
  }

  public dispose(): void {
    for (const timer of this.pendingDrainTimers.values()) {
      clearTimeout(timer)
    }
    this.pendingDrainTimers.clear()

    for (const timer of this.prefetchTimers.values()) {
      clearTimeout(timer)
    }
    this.prefetchTimers.clear()
    this.prefetchedTopicsByRoute.clear()

    for (const topic of Array.from(this.refCounts.keys())) {
      this.refCounts.delete(topic)
      this.onUnsubscribeTopic?.(topic)
    }
    this.currentRouteTopics.clear()
  }

  private clearRoutePrefetch(normalizedRoute: string): void {
    const timer = this.prefetchTimers.get(normalizedRoute)
    if (timer) {
      clearTimeout(timer)
      this.prefetchTimers.delete(normalizedRoute)
    }
    const topics = this.prefetchedTopicsByRoute.get(normalizedRoute)
    if (!topics) return
    this.prefetchedTopicsByRoute.delete(normalizedRoute)
    for (const topic of topics) {
      this.releaseTopic(topic)
    }
  }

  private retainTopic(topic: string): void {
    const pendingDrain = this.pendingDrainTimers.get(topic)
    if (pendingDrain) {
      clearTimeout(pendingDrain)
      this.pendingDrainTimers.delete(topic)
    }

    const current = this.refCounts.get(topic) ?? 0
    this.refCounts.set(topic, current + 1)
    if (current === 0 && !pendingDrain) {
      this.onSubscribeTopic?.(topic)
    }
  }

  private releaseTopic(topic: string): void {
    const current = this.refCounts.get(topic) ?? 0
    if (current <= 0) return

    const next = current - 1
    if (next > 0) {
      this.refCounts.set(topic, next)
      return
    }

    if (this.drainGraceMs <= 0) {
      this.refCounts.delete(topic)
      this.onUnsubscribeTopic?.(topic)
      return
    }

    this.refCounts.set(topic, 0)
    const timer = setTimeout(() => {
      this.pendingDrainTimers.delete(topic)
      if ((this.refCounts.get(topic) ?? 0) === 0) {
        this.refCounts.delete(topic)
        this.onUnsubscribeTopic?.(topic)
      }
    }, this.drainGraceMs)
    this.pendingDrainTimers.set(topic, timer)
  }
}

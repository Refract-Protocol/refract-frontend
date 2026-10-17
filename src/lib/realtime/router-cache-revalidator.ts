export interface RealtimeRevalidationEvent {
  eventId: string;
  topic: string;
  occurredAtMs: number;
  entityId?: string;
}

export interface RouteRevalidationTarget {
  topicPrefix: string;
  paths: string[];
  tags: string[];
}

export interface RevalidationFlushResult {
  flushedAtMs: number;
  coalescedEventCount: number;
  refreshedPaths: string[];
  revalidatedTags: string[];
}

export interface RouterCacheRevalidatorOptions {
  coalesceWindowMs?: number;
  maxSeenEventIds?: number;
  nowFn?: () => number;
  onRevalidate?: (result: RevalidationFlushResult) => void;
}

export const DEFAULT_REVALIDATION_TARGETS: readonly RouteRevalidationTarget[] = [
  {
    topicPrefix: 'policies',
    paths: ['/policies', '/dashboard'],
    tags: ['policies', 'portfolio-summary'],
  },
  {
    topicPrefix: 'claims',
    paths: ['/claims', '/policies'],
    tags: ['claims', 'policies'],
  },
  {
    topicPrefix: 'liquidity',
    paths: ['/liquidity', '/dashboard'],
    tags: ['liquidity-pools', 'tvl-stats'],
  },
  {
    topicPrefix: 'protocol.parameters',
    paths: ['/cover', '/liquidity'],
    tags: ['protocol-parameters'],
  },
];

/**
 * Coalesces high-frequency realtime events into rate-limited Next.js Router Cache
 * revalidation calls while guarding against infinite loops and active form interruptions.
 */
export class RouterCacheRevalidator {
  private readonly coalesceWindowMs: number;
  private readonly maxSeenEventIds: number;
  private readonly nowFn: () => number;
  private readonly onRevalidate?: (result: RevalidationFlushResult) => void;
  private readonly targets: RouteRevalidationTarget[];

  private readonly seenEventIds = new Set<string>();
  private readonly seenOrder: string[] = [];
  private readonly pendingPaths = new Set<string>();
  private readonly pendingTags = new Set<string>();
  private pendingEventCount = 0;
  private lastFlushAtMs = -Infinity;
  private inFlightNavigation = false;
  private activeCriticalFlow: string | null = null;

  constructor(
    targets: readonly RouteRevalidationTarget[] = DEFAULT_REVALIDATION_TARGETS,
    options: RouterCacheRevalidatorOptions = {}
  ) {
    this.targets = [...targets];
    this.coalesceWindowMs = options.coalesceWindowMs ?? 3_000;
    this.maxSeenEventIds = options.maxSeenEventIds ?? 500;
    this.nowFn = options.nowFn ?? (() => Date.now());
    this.onRevalidate = options.onRevalidate;
  }

  setInFlightNavigation(inFlight: boolean): RevalidationFlushResult | null {
    this.inFlightNavigation = inFlight;
    if (!inFlight && this.canFlushNow()) {
      return this.flush();
    }
    return null;
  }

  /**
   * Pauses router refresh while the user is in a critical step (e.g., `/cover` confirmation).
   */
  setActiveCriticalFlow(flowName: string | null): RevalidationFlushResult | null {
    this.activeCriticalFlow = flowName;
    if (flowName === null && this.canFlushNow()) {
      return this.flush();
    }
    return null;
  }

  /**
   * Records a realtime event and flushes immediately only if outside the coalescing window
   * and no navigation or critical flow is active.
   */
  ingestEvent(event: RealtimeRevalidationEvent): {
    accepted: boolean;
    reason?: 'duplicate_event' | 'unmapped_topic' | 'coalesced_pending' | 'flushed';
    flushResult?: RevalidationFlushResult;
  } {
    if (this.seenEventIds.has(event.eventId)) {
      return { accepted: false, reason: 'duplicate_event' };
    }

    const matched = this.targets.filter(
      (t) => event.topic === t.topicPrefix || event.topic.startsWith(`${t.topicPrefix}.`)
    );
    if (matched.length === 0) {
      return { accepted: false, reason: 'unmapped_topic' };
    }

    this.recordSeenEvent(event.eventId);

    for (const target of matched) {
      for (const p of target.paths) this.pendingPaths.add(p);
      for (const tag of target.tags) this.pendingTags.add(tag);
    }
    this.pendingEventCount += 1;

    if (this.canFlushNow()) {
      const flushResult = this.flush();
      if (flushResult) {
        return { accepted: true, reason: 'flushed', flushResult };
      }
    }

    return { accepted: true, reason: 'coalesced_pending' };
  }

  hasPendingRevalidation(): boolean {
    return this.pendingEventCount > 0;
  }

  flush(): RevalidationFlushResult | null {
    if (this.pendingEventCount === 0) {
      return null;
    }
    if (this.inFlightNavigation || this.activeCriticalFlow !== null) {
      return null;
    }

    const now = this.nowFn();
    const result: RevalidationFlushResult = {
      flushedAtMs: now,
      coalescedEventCount: this.pendingEventCount,
      refreshedPaths: Array.from(this.pendingPaths).sort(),
      revalidatedTags: Array.from(this.pendingTags).sort(),
    };

    this.pendingPaths.clear();
    this.pendingTags.clear();
    this.pendingEventCount = 0;
    this.lastFlushAtMs = now;

    this.onRevalidate?.(result);
    return result;
  }

  private canFlushNow(): boolean {
    if (this.pendingEventCount === 0) return false;
    if (this.inFlightNavigation || this.activeCriticalFlow !== null) return false;
    return this.nowFn() - this.lastFlushAtMs >= this.coalesceWindowMs;
  }

  private recordSeenEvent(eventId: string): void {
    this.seenEventIds.add(eventId);
    this.seenOrder.push(eventId);
    while (this.seenOrder.length > this.maxSeenEventIds) {
      const oldest = this.seenOrder.shift();
      if (oldest) {
        this.seenEventIds.delete(oldest);
      }
    }
  }
}

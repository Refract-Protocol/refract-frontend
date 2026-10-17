import type { ClaimRecord } from "@/lib/api/claims";
import type { OracleReading } from "@/lib/api/oracle";
import type { PoolStats } from "@/lib/api/pool";
import type { RefractNotification } from "@/lib/notifications";

export interface RealtimeMergeEnvelope<TPayload> {
  /** Unique message identifier used for transport-level deduplication. */
  id: string;
  /** Monotonically increasing sequence number within the topic/entity stream. */
  seq: number;
  /** Server emission timestamp in Unix milliseconds. */
  ts: number;
  /** Frame kind: full snapshot, incremental delta/event, or removal tombstone. */
  type?: "snapshot" | "delta" | "event" | "remove";
  /** Topic-specific payload. */
  payload: TPayload;
}

export interface MergedViewState<TView> {
  /** Current reconciled view presented to React hooks. */
  data: TView;
  /** Highest sequence number applied per entity key (or `__root__` for singletons). */
  entityVersions: Readonly<Record<string, { seq: number; ts: number }>>;
  /** Bounded set of recently applied frame IDs to guarantee idempotency. */
  seenEventIds: ReadonlySet<string>;
  /** Highest global sequence number seen across the topic. */
  lastSeq: number;
  /** Timestamp (`ts`) of the newest applied realtime event, or `null` if REST-only. */
  lastEventAt: number | null;
  /** Timestamp (`ts`) at which the baseline REST snapshot was captured. */
  snapshotAt: number;
}

export interface CollectionMergeConfig<TItem, TPayload = TItem> {
  /** Extracts the unique entity primary key from an existing state item. */
  getItemKey: (item: TItem) => string;
  /** Extracts the unique entity primary key from an incoming event payload. */
  getPayloadKey: (payload: TPayload) => string;
  /** Maps or merges an incoming payload into an item (receives previous item if present). */
  toItem: (payload: TPayload, existing: TItem | undefined) => TItem;
  /** Optional comparator to keep the collection deterministically ordered. */
  compare?: (a: TItem, b: TItem) => number;
  /** Maximum number of seen event IDs retained for deduplication (default: 512). */
  maxSeenIds?: number;
}

export interface SingletonMergeConfig<TState, TPayload = TState> {
  /** Merges an incoming payload with the previous singleton state. */
  reduce: (current: TState, payload: TPayload) => TState;
  /** Maximum number of seen event IDs retained for deduplication (default: 256). */
  maxSeenIds?: number;
}

export interface RealtimeMerger<TView, TPayload> {
  /** Initializes reconciled state from a REST snapshot. */
  fromSnapshot: (snapshot: TView, snapshotAt?: number) => MergedViewState<TView>;
  /** Rebase state on a newly fetched REST snapshot without overwriting fresher realtime updates. */
  rebaseSnapshot: (
    state: MergedViewState<TView>,
    snapshot: TView,
    snapshotAt?: number,
  ) => MergedViewState<TView>;
  /** Pure reducer applying a single realtime event envelope. */
  applyEvent: (
    state: MergedViewState<TView>,
    event: RealtimeMergeEnvelope<TPayload>,
  ) => MergedViewState<TView>;
  /** Pure batch reducer applying a sequence of realtime event envelopes. */
  applyEvents: (
    state: MergedViewState<TView>,
    events: Iterable<RealtimeMergeEnvelope<TPayload>>,
  ) => MergedViewState<TView>;
}

function appendBoundedSet(set: ReadonlySet<string>, id: string, maxSize: number): ReadonlySet<string> {
  const next = new Set(set);
  next.add(id);
  if (next.size > maxSize) {
    const oldest = next.values().next().value;
    if (oldest !== undefined) {
      next.delete(oldest);
    }
  }
  return next;
}

function isStaleVersion(
  current: { seq: number; ts: number } | undefined,
  incoming: { seq: number; ts: number },
  snapshotAt: number,
): boolean {
  if (!current) {
    return incoming.ts > 0 && snapshotAt > 0 && incoming.ts < snapshotAt && incoming.seq === 0;
  }
  if (incoming.seq !== current.seq) {
    return incoming.seq < current.seq;
  }
  return incoming.ts <= current.ts;
}

/**
 * Builds a pure, transport-agnostic collection merger that reconciles REST array
 * snapshots with streamed realtime insert/update/remove events.
 */
export function createCollectionMerger<TItem, TPayload = TItem>(
  config: CollectionMergeConfig<TItem, TPayload>,
): RealtimeMerger<TItem[], TPayload> {
  const maxSeenIds = config.maxSeenIds ?? 512;

  const sortIfNeeded = (items: TItem[]): TItem[] => {
    if (!config.compare) return items;
    return [...items].sort(config.compare);
  };

  const fromSnapshot = (snapshot: TItem[], snapshotAt = 0): MergedViewState<TItem[]> => {
    const deduped = new Map<string, TItem>();
    for (const item of snapshot) {
      deduped.set(config.getItemKey(item), item);
    }
    return {
      data: sortIfNeeded(Array.from(deduped.values())),
      entityVersions: {},
      seenEventIds: new Set<string>(),
      lastSeq: 0,
      lastEventAt: null,
      snapshotAt,
    };
  };

  const rebaseSnapshot = (
    state: MergedViewState<TItem[]>,
    snapshot: TItem[],
    snapshotAt = 0,
  ): MergedViewState<TItem[]> => {
    const existingByKey = new Map<string, TItem>();
    for (const item of state.data) {
      existingByKey.set(config.getItemKey(item), item);
    }

    const mergedByKey = new Map<string, TItem>();
    for (const snapItem of snapshot) {
      const key = config.getItemKey(snapItem);
      const entityVer = state.entityVersions[key];
      const existingItem = existingByKey.get(key);
      if (entityVer && existingItem && (snapshotAt === 0 || entityVer.ts >= snapshotAt)) {
        mergedByKey.set(key, existingItem);
      } else {
        mergedByKey.set(key, config.toItem(snapItem as unknown as TPayload, existingItem));
      }
    }

    // Preserve entities inserted via realtime that are newer than the snapshot
    for (const [key, existingItem] of existingByKey.entries()) {
      if (!mergedByKey.has(key)) {
        const entityVer = state.entityVersions[key];
        if (entityVer && (snapshotAt === 0 || entityVer.ts >= snapshotAt)) {
          mergedByKey.set(key, existingItem);
        }
      }
    }

    return {
      ...state,
      data: sortIfNeeded(Array.from(mergedByKey.values())),
      snapshotAt: Math.max(state.snapshotAt, snapshotAt),
    };
  };

  const applyEvent = (
    state: MergedViewState<TItem[]>,
    event: RealtimeMergeEnvelope<TPayload>,
  ): MergedViewState<TItem[]> => {
    if (state.seenEventIds.has(event.id)) {
      return state;
    }

    const key = config.getPayloadKey(event.payload);
    const currentVer = state.entityVersions[key];
    if (isStaleVersion(currentVer, { seq: event.seq, ts: event.ts }, state.snapshotAt)) {
      return state;
    }

    const nextSeen = appendBoundedSet(state.seenEventIds, event.id, maxSeenIds);
    const nextVersions = {
      ...state.entityVersions,
      [key]: { seq: event.seq, ts: event.ts },
    };

    const existingIdx = state.data.findIndex((item) => config.getItemKey(item) === key);
    let nextData: TItem[];

    if (event.type === "remove") {
      if (existingIdx === -1) {
        return {
          ...state,
          entityVersions: nextVersions,
          seenEventIds: nextSeen,
          lastSeq: Math.max(state.lastSeq, event.seq),
          lastEventAt: state.lastEventAt === null ? event.ts : Math.max(state.lastEventAt, event.ts),
        };
      }
      nextData = state.data.filter((_, idx) => idx !== existingIdx);
    } else {
      const existingItem = existingIdx >= 0 ? state.data[existingIdx] : undefined;
      const updatedItem = config.toItem(event.payload, existingItem);
      if (existingIdx >= 0) {
        nextData = state.data.map((item, idx) => (idx === existingIdx ? updatedItem : item));
      } else {
        nextData = [...state.data, updatedItem];
      }
      nextData = sortIfNeeded(nextData);
    }

    return {
      data: nextData,
      entityVersions: nextVersions,
      seenEventIds: nextSeen,
      lastSeq: Math.max(state.lastSeq, event.seq),
      lastEventAt: state.lastEventAt === null ? event.ts : Math.max(state.lastEventAt, event.ts),
      snapshotAt: state.snapshotAt,
    };
  };

  const applyEvents = (
    state: MergedViewState<TItem[]>,
    events: Iterable<RealtimeMergeEnvelope<TPayload>>,
  ): MergedViewState<TItem[]> => {
    let current = state;
    for (const ev of events) {
      current = applyEvent(current, ev);
    }
    return current;
  };

  return {
    fromSnapshot,
    rebaseSnapshot,
    applyEvent,
    applyEvents,
  };
}

/**
 * Builds a pure, transport-agnostic singleton merger for aggregate topic views
 * such as `pool.stats`.
 */
export function createSingletonMerger<TState, TPayload = TState>(
  config: SingletonMergeConfig<TState, TPayload>,
): RealtimeMerger<TState, TPayload> {
  const maxSeenIds = config.maxSeenIds ?? 256;
  const ROOT_KEY = "__root__";

  const fromSnapshot = (snapshot: TState, snapshotAt = 0): MergedViewState<TState> => ({
    data: snapshot,
    entityVersions: {},
    seenEventIds: new Set<string>(),
    lastSeq: 0,
    lastEventAt: null,
    snapshotAt,
  });

  const rebaseSnapshot = (
    state: MergedViewState<TState>,
    snapshot: TState,
    snapshotAt = 0,
  ): MergedViewState<TState> => {
    const rootVer = state.entityVersions[ROOT_KEY];
    if (rootVer && (snapshotAt === 0 || rootVer.ts >= snapshotAt)) {
      return {
        ...state,
        snapshotAt: Math.max(state.snapshotAt, snapshotAt),
      };
    }
    return {
      ...state,
      data: snapshot,
      snapshotAt: Math.max(state.snapshotAt, snapshotAt),
    };
  };

  const applyEvent = (
    state: MergedViewState<TState>,
    event: RealtimeMergeEnvelope<TPayload>,
  ): MergedViewState<TState> => {
    if (state.seenEventIds.has(event.id)) {
      return state;
    }

    const currentVer = state.entityVersions[ROOT_KEY];
    if (isStaleVersion(currentVer, { seq: event.seq, ts: event.ts }, state.snapshotAt)) {
      return state;
    }

    return {
      data: config.reduce(state.data, event.payload),
      entityVersions: {
        ...state.entityVersions,
        [ROOT_KEY]: { seq: event.seq, ts: event.ts },
      },
      seenEventIds: appendBoundedSet(state.seenEventIds, event.id, maxSeenIds),
      lastSeq: Math.max(state.lastSeq, event.seq),
      lastEventAt: state.lastEventAt === null ? event.ts : Math.max(state.lastEventAt, event.ts),
      snapshotAt: state.snapshotAt,
    };
  };

  const applyEvents = (
    state: MergedViewState<TState>,
    events: Iterable<RealtimeMergeEnvelope<TPayload>>,
  ): MergedViewState<TState> => {
    let current = state;
    for (const ev of events) {
      current = applyEvent(current, ev);
    }
    return current;
  };

  return {
    fromSnapshot,
    rebaseSnapshot,
    applyEvent,
    applyEvents,
  };
}

/**
 * Domain merger for `oracle.readings` (`useOracleStatus`), keyed by `coverageType`.
 */
export const oracleReadingsMerger = createCollectionMerger<OracleReading>({
  getItemKey: (reading) => reading.coverageType,
  getPayloadKey: (payload) => payload.coverageType,
  toItem: (payload) => payload,
});

/**
 * Domain merger for `claims.settlement` (`useRecentClaims` & `useClaims`),
 * keyed by `${policyId}:${processedAt}` and sorted newest-first.
 */
export const claimsSettlementMerger = createCollectionMerger<ClaimRecord>({
  getItemKey: (claim) => `${claim.policyId}:${claim.processedAt}`,
  getPayloadKey: (payload) => `${payload.policyId}:${payload.processedAt}`,
  toItem: (payload, existing) => ({
    ...existing,
    ...payload,
  }),
  compare: (a, b) => b.processedAt - a.processedAt || a.policyId.localeCompare(b.policyId),
});

/**
 * Domain merger for `pool.stats` (`usePoolStats`).
 */
export const poolStatsMerger = createSingletonMerger<PoolStats, Partial<PoolStats>>({
  reduce: (current, patch) => ({
    ...current,
    ...patch,
  }),
});

/**
 * Domain merger for `notifications` (`useNotifications`), preserving local `read: true`
 * state if a notification has already been acknowledged by the user.
 */
export const notificationsMerger = createCollectionMerger<RefractNotification>({
  getItemKey: (n) => n.id,
  getPayloadKey: (p) => p.id,
  toItem: (payload, existing) => ({
    ...payload,
    read: existing?.read ? true : payload.read,
  }),
  compare: (a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id),
});

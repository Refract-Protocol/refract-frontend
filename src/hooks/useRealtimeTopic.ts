"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import { fidelityController, realtimeBus, realtimeClient } from "@/lib/realtime";
import type { ConnectionState } from "@/lib/realtime/client";
import type { RealtimeTopic, RealtimeTopics, RealtimeViewStatus } from "@/lib/realtime";
import {
  clearPersistedSubscriptions,
  persistSubscriptions,
  readPersistedSubscriptions,
  type PersistedSubscription,
} from "../lib/realtime/persistence";
import {
  mergeRealtimeEvent,
  mergeSnapshot,
  type MergeFn,
  type RealtimeEvent,
  type RealtimeState,
} from "../lib/realtime/merge";
import { getRegistry, type SubscriptionRegistry } from "../lib/realtime/registry";
import type { RealtimeClient } from "../lib/realtime/client";

/** Maps data presence and transport state to the shared view-status enum. */
export function deriveViewStatus(
  hasData: boolean,
  enabled: boolean,
  conn: ConnectionState
): RealtimeViewStatus {
  if (!hasData) return "empty";
  if (!enabled) return "polling";
  if (conn === "connected") return "live";
  if (conn === "reconnecting") return "reconnecting";
  return "disconnected";
}

export type RealtimeStatus = "idle" | "loading" | "live" | "polling" | "error";

export interface UseRealtimeTopicOptions<T> {
  /**
   * Whether updates for this topic are replaceable (only the latest value matters).
   * Replaceable topics are coalesced to at most one render per animation frame.
   */
  replaceable?: boolean;
  /**
   * Optional selector to derive the rendered value from the merged state.
   * Defaults to the merged state itself.
   */
  select?: (state: RealtimeState<T>) => RealtimeState<T>;
  /** Fetches the REST snapshot used as the initial/fallback value. */
  snapshotFetcher?: () => Promise<T>;
  /** Merge rule applied to streamed events (defaults to latest-wins). */
  merge?: MergeFn<T>;
  /** When false the hook skips realtime and relies on polling only. */
  enabled?: boolean;
  /** Injectable polling strategy used when realtime is disabled/unavailable. */
  pollIntervalMs?: number;
  /** Whether the realtime feature flag is on. */
  realtimeEnabled?: boolean;
  /** Whether the realtime connection is healthy. */
  connected?: boolean;
  /** Subscribes to a topic; returns an unsubscribe function. */
  subscribe?: (topic: string, onEvent: (event: T) => void) => () => void;
  /** Realtime client used to resolve the shared subscription registry. */
  client?: RealtimeClient;
  /** Explicit registry override (tests / inspector). */
  registry?: SubscriptionRegistry;
  /** Scope used to namespace persisted subscriptions. */
  scope?: string;
  /** Wallet used to namespace persisted subscriptions. */
  wallet?: string;
  /** Known topics used to validate persisted subscriptions. */
  knownTopics?: ReadonlySet<string>;
  /** REST snapshot used for first paint and as the fallback when realtime is off. */
  initial?: T;
  /** Keep this topic subscribed even when the fidelity tier would drop it (e.g. claim settlement). */
  critical?: boolean;
}

export interface UseRealtimeTopicResult<T> {
  data: T | undefined;
  status: RealtimeStatus;
  lastEventAt: number | null;
  cursor: string | null;
  setCursor: (cursor: string | null) => void;
  clear: () => void;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;

const isTestEnv = (): boolean => {
  if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "test") {
    return true;
  }
  return typeof (globalThis as { __REALTIME_DISABLE_COALESCE__?: boolean }).__REALTIME_DISABLE_COALESCE__ === "boolean"
    ? Boolean((globalThis as { __REALTIME_DISABLE_COALESCE__?: boolean }).__REALTIME_DISABLE_COALESCE__)
    : false;
};

const prefersReducedMotion = (): boolean => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

const scheduleFrame = (cb: () => void): (() => void) => {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    const id = window.requestAnimationFrame(cb);
    return () => window.cancelAnimationFrame(id);
  }
  const id = setTimeout(cb, 16);
  return () => clearTimeout(id);
};

/**
 * Generic React binding over the realtime transport + merge layers.
 *
 * Subscribes on mount, tears down on unmount, reacts to connection health,
 * and falls back to REST polling when realtime is disabled or unavailable.
 * Subscriptions are routed through the shared registry so identical topics are
 * reference-counted rather than opened per hook instance.
 *
 * Replaceable topics (e.g. oracle readings) are buffered and flushed at most
 * once per animation frame so high-frequency streams cannot cause render
 * storms. A trailing-edge flush guarantees the latest value is always rendered.
 * Coalescing is disabled under reduced motion and in automated tests so
 * flushing is deterministic.
 *
 * The last cursor for a topic is persisted to session storage and rehydrated
 * on mount so reloads and route navigations resume from the snapshot instead
 * of refetching from scratch.
 */
export function useRealtimeTopic<T extends RealtimeTopic>(
  topic: T,
  options: UseRealtimeTopicOptions<RealtimeTopics[T]> = {}
): UseRealtimeTopicResult<RealtimeTopics[T]> & { enabled: boolean } {
  const {
    replaceable = false,
    select,
    snapshotFetcher,
    merge,
    enabled = true,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    realtimeEnabled = true,
    connected = true,
    subscribe,
    client,
    registry,
    scope = "",
    wallet = "",
    knownTopics,
    initial,
    critical = false,
  } = options;

  const flagEnabled = useFeatureFlag("realtime-oracle");
  const [data, setData] = useState<RealtimeTopics[T] | undefined>(initial);
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [cursor, setCursorState] = useState<string | null>(null);
  const hydratedRef = useRef(false);

  // Keep the latest merge/fetcher/select in refs so effects don't resubscribe
  // on every render (avoids resubscribe storms).
  const mergeRef = useRef(merge);
  mergeRef.current = merge;
  const fetcherRef = useRef(snapshotFetcher);
  fetcherRef.current = snapshotFetcher;
  const selectRef = useRef(select);
  selectRef.current = select;

  const pendingEventsRef = useRef<RealtimeTopics[T][]>([]);
  const mountedRef = useRef(true);

  // Coalescing state for replaceable topics.
  const stateRef = useRef<RealtimeState<RealtimeTopics[T]> | undefined>(undefined);
  const pendingRef = useRef<RealtimeState<RealtimeTopics[T]> | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const coalesce = replaceable && !isTestEnv() && !prefersReducedMotion();
  const coalesceRef = useRef(coalesce);
  coalesceRef.current = coalesce;

  const flush = useCallback((): void => {
    cancelRef.current = null;
    const next = pendingRef.current;
    if (next === null) {
      return;
    }
    pendingRef.current = null;
    stateRef.current = next;
    if (mountedRef.current) {
      setData(next as unknown as RealtimeTopics[T]);
    }
  }, []);

  const apply = useCallback((next: RealtimeState<RealtimeTopics[T]>): void => {
    if (!coalesceRef.current) {
      stateRef.current = next;
      if (mountedRef.current) {
        setData(next as unknown as RealtimeTopics[T]);
      }
      return;
    }
    pendingRef.current = next;
    if (cancelRef.current === null) {
      cancelRef.current = scheduleFrame(flush);
    }
  }, [flush]);

  const applyEvent = useCallback((event: RealtimeTopics[T]) => {
    if (!mountedRef.current) return;
    const current = stateRef.current;
    const merged = current !== undefined
      ? mergeRealtimeEvent(current, event as unknown as RealtimeEvent<RealtimeTopics[T]>)
      : (event as unknown as RealtimeState<RealtimeTopics[T]>);
    const selected = selectRef.current ? selectRef.current(merged) : merged;
    apply(selected);
    setLastEventAt(Date.now());
  }, [apply]);

  const fetchSnapshot = useCallback(async () => {
    const fetcher = fetcherRef.current;
    if (!fetcher) return;
    try {
      const snapshot = await fetcher();
      if (!mountedRef.current) return;
      const pending = pendingEventsRef.current;
      pendingEventsRef.current = [];
      const merged = mergeSnapshot(snapshot, pending, mergeRef.current);
      stateRef.current = merged as unknown as RealtimeState<RealtimeTopics[T]>;
      setData(merged);
    } catch {
      if (mountedRef.current) setStatus("error");
    }
  }, []);

  // Resolve the registry: explicit override, else the shared registry bound to
  // the client. Falls back to a direct subscribe when neither is available.
  const resolvedRegistry = registry ?? (client ? getRegistry(client) : undefined);
  const subscribeFn = resolvedRegistry
    ? (t: string, onEvent: (event: RealtimeTopics[T]) => void) => resolvedRegistry.subscribe<RealtimeTopics[T]>(t, onEvent)
    : subscribe;

  const realtimeActive = enabled && realtimeEnabled && connected && !!subscribeFn;

  // Rehydrate the persisted cursor for this topic on mount.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const persisted = readPersistedSubscriptions(wallet, scope, knownTopics);
    const match = persisted.find((entry) => entry.topic === topic);
    if (match) setCursorState(match.cursor);
  }, [wallet, scope, topic, knownTopics]);

  const persist = useCallback(
    (nextCursor: string | null) => {
      const existing = readPersistedSubscriptions(wallet, scope, knownTopics);
      const others = existing.filter((entry) => entry.topic !== topic);
      const next: PersistedSubscription[] = [
        ...others,
        { topic, scope, cursor: nextCursor },
      ];
      persistSubscriptions(wallet, scope, next);
    },
    [wallet, scope, topic, knownTopics],
  );

  const setCursor = useCallback(
    (nextCursor: string | null) => {
      setCursorState(nextCursor);
      persist(nextCursor);
    },
    [persist],
  );

  const clear = useCallback(() => {
    setCursorState(null);
    clearPersistedSubscriptions(wallet, scope);
  }, [wallet, scope]);

  // Snapshot fetch on mount / when the topic changes.
  useEffect(() => {
    mountedRef.current = true;
    setStatus("loading");
    void fetchSnapshot();
    return () => {
      mountedRef.current = false;
    };
  }, [topic, fetchSnapshot]);

  // Realtime subscription lifecycle (routed through the registry).
  useEffect(() => {
    if (!realtimeActive || !subscribeFn) return;
    setStatus("live");
    const unsubscribe = subscribeFn(topic, (event) => {
      if (pendingEventsRef.current.length > 0) {
        pendingEventsRef.current.push(event);
      }
      applyEvent(event);
    });
    return () => {
      unsubscribe();
      if (cancelRef.current !== null) {
        cancelRef.current();
        cancelRef.current = null;
      }
      // Trailing-edge flush on unmount so the latest value is never stranded.
      flush();
    };
  }, [topic, realtimeActive, subscribeFn, applyEvent, flush]);

  // REST polling fallback when realtime is disabled or unavailable.
  useEffect(() => {
    if (!enabled || realtimeActive) return;
    setStatus("polling");
    const interval = setInterval(() => {
      void fetchSnapshot();
    }, pollIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, realtimeActive, pollIntervalMs, fetchSnapshot]);

  // Event-bus subscription (never the socket directly). Late mounts read the
  // bus snapshot; `status` is the single enum views map to presentation, so
  // components never inspect transport internals.
  useEffect(() => {
    if (!flagEnabled) return;
    const snap = realtimeBus.getSnapshot(topic);
    if (snap !== undefined) setData(snap as unknown as RealtimeTopics[T]);
    const offBus = realtimeBus.subscribe(topic, (value) => {
      setData(value as unknown as RealtimeTopics[T]);
    });
    const offConn = realtimeClient.onConnectionChange((conn: ConnectionState) => {
      setStatus(deriveViewStatus(true, flagEnabled, conn) as unknown as RealtimeStatus);
    });
    const release = critical ? fidelityController.requireTopic(topic) : () => {};
    realtimeClient.connect();
    return () => {
      offBus();
      offConn();
      release();
    };
  }, [flagEnabled, topic, critical]);

  return { data, status, lastEventAt, cursor, setCursor, clear, enabled: flagEnabled };
}

/**
 * Deterministic flush hook for tests: forces any buffered replaceable update
 * to render immediately.
 */
export function useRealtimeFlush(): () => void {
  return () => {
    if (typeof (globalThis as { __REALTIME_FLUSH__?: () => void }).__REALTIME_FLUSH__ === "function") {
      (globalThis as { __REALTIME_FLUSH__?: () => void }).__REALTIME_FLUSH__!();
    }
  };
}


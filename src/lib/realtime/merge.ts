/**
 * Realtime merge utilities.
 *
 * Event classes are either *replaceable* (only the newest value matters, e.g.
 * oracle readings) or *append* (every event must be observed, e.g. logs).
 * Replaceable classes are coalesced within a bounded window so a busy stream
 * renders at most once per window while always flushing the latest value.
 */

import type { RealtimeEvent } from './client';
import { ShadowMode, type ShadowTopic } from './shadow';

export type MergeStrategy = 'replace' | 'append';

/**
 * Event classes that are inherently replaceable. Only the newest value of a
 * replaceable class is meaningful, so high-frequency bursts can be coalesced.
 */
export const REPLACEABLE_EVENT_CLASSES: ReadonlySet<string> = new Set([
  'oracle',
  'oracle-reading',
  'oracleReading',
  'price',
  'ticker',
]);

export function isReplaceableEventClass(eventClass: string): boolean {
  return REPLACEABLE_EVENT_CLASSES.has(eventClass);
}

export function mergeStrategyFor(eventClass: string): MergeStrategy {
  return isReplaceableEventClass(eventClass) ? 'replace' : 'append';
}

/**
 * Merge a batch of events for a single topic. Replaceable classes keep only the
 * latest event; append classes keep every event in arrival order.
 */
export function mergeEvents<T>(
  eventClass: string,
  events: readonly T[],
): T[] {
  if (events.length === 0) return [];
  if (mergeStrategyFor(eventClass) === 'replace') {
    return [events[events.length - 1]];
  }
  return [...events];
}

/**
 * Coalesces replaceable updates on a frame/timer budget.
 *
 * - `push` buffers the latest value per key.
 * - `flush` drains the buffer and invokes the sink once with the latest value
 *   for each key (trailing-edge flush, so the final value is never dropped).
 * - `schedule` requests a flush on the next animation frame (or a short timer
 *   fallback) unless coalescing is disabled.
 *
 * Coalescing is disabled under reduced motion and in automated tests, where
 * flushing must be deterministic.
 */
export interface CoalescerOptions {
  /** Called once per flush with the latest buffered value per key. */
  onFlush: (updates: Map<string, unknown>) => void;
  /** Override the coalescing window in ms. Defaults to one frame. */
  windowMs?: number;
  /** Force-disable coalescing (e.g. reduced motion or tests). */
  disabled?: boolean;
}

const DEFAULT_WINDOW_MS = 16;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isTestEnvironment(): boolean {
  return (
    typeof process !== 'undefined' &&
    (process.env?.NODE_ENV === 'test' || process.env?.VITEST === 'true')
  );
}

export function shouldCoalesce(disabled?: boolean): boolean {
  if (disabled) return false;
  if (isTestEnvironment()) return false;
  if (prefersReducedMotion()) return false;
  return true;
}

export interface Coalescer {
  push: (key: string, value: unknown) => void;
  flush: () => void;
  schedule: () => void;
  dispose: () => void;
}

export function createCoalescer(options: CoalescerOptions): Coalescer {
  const { onFlush, windowMs = DEFAULT_WINDOW_MS } = options;
  const buffer = new Map<string, unknown>();
  let handle: ReturnType<typeof setTimeout> | null = null;
  let frame: number | null = null;
  let disposed = false;

  const clearScheduled = () => {
    if (frame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frame);
    }
    frame = null;
    if (handle !== null) {
      clearTimeout(handle);
    }
    handle = null;
  };

  const flush = () => {
    clearScheduled();
    if (buffer.size === 0) return;
    const updates = new Map(buffer);
    buffer.clear();
    onFlush(updates);
  };

  const schedule = () => {
    if (disposed || handle !== null || frame !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      frame = requestAnimationFrame(() => {
        frame = null;
        flush();
      });
    } else {
      handle = setTimeout(() => {
        handle = null;
        flush();
      }, windowMs);
    }
  };

  const push = (key: string, value: unknown) => {
    if (disposed) return;
    buffer.set(key, value);
    if (shouldCoalesce(options.disabled)) {
      schedule();
    } else {
      // Deterministic path: flush immediately so tests and reduced-motion
      // users observe every update without a frame delay.
      flush();
    }
  };

  const dispose = () => {
    disposed = true;
    clearScheduled();
    buffer.clear();
  };

  return { push, flush, schedule, dispose };
}

export type MergeFn<T> = (current: T | undefined, incoming: T) => T;

/**
 * Default merge strategy: the latest value wins.
 * Suitable for snapshot-style topics where each event carries full state.
 */
export const replaceMerge: MergeFn<unknown> = (_current, incoming) => incoming;

/**
 * Merge a REST snapshot with any events that arrived while the snapshot was
 * in flight. Events are applied in arrival order on top of the snapshot so a
 * slow fetch never clobbers fresher streamed data.
 */
export function mergeSnapshot<T>(
  snapshot: T | undefined,
  pendingEvents: readonly T[],
  merge: MergeFn<T> = replaceMerge as MergeFn<T>,
): T | undefined {
  let result = snapshot;
  for (const event of pendingEvents) {
    result = merge(result, event);
  }
  return result;
}

/**
 * Append-style merge for list topics: keeps the newest `limit` items and
 * de-duplicates by `id` when present.
 */
export function appendMerge<T extends { id?: string | number }>(
  limit = 100,
): MergeFn<T[]> {
  return (current, incoming) => {
    const base = current ?? [];
    const next = incoming.id === undefined
      ? [...base, incoming]
      : [...base.filter((item) => item.id !== incoming.id), incoming];
    return next.length > limit ? next.slice(next.length - limit) : next;
  };
}

export interface TopicState<T> {
  snapshot: T;
  cursor: number;
  appliedIds: Set<string>;
}

export interface MergeState<T> {
  polled: T | null;
  realtime: T | null;
}

export interface MergeOptions {
  /** Maximum number of event ids retained for idempotency checks. */
  maxAppliedIds?: number;
  /** Maximum cursor gap tolerated before falling back to a fresh snapshot. */
  maxReplayWindow?: number;
  /** Shadow mode recorder; disabled by default. */
  shadow?: ShadowMode | null;
  /** Topic used for shadow comparisons. */
  topic?: ShadowTopic;
  /** Stable key for discrepancy reports. */
  key?: string;
}

const DEFAULT_MAX_APPLIED_IDS = 512;
const DEFAULT_MAX_REPLAY_WINDOW = 1000;

/**
 * Create an empty topic state seeded from a REST snapshot.
 * The snapshot's own cursor is used as the baseline so any event at or below
 * it is considered already reflected and will not be re-applied.
 */
export function createTopicState<T>(snapshot: T, cursor: number): TopicState<T> {
  return { snapshot, cursor, appliedIds: new Set() };
}

/**
 * Determine whether a replayed event should be applied given the current
 * cursor. Events at or below the cursor are already reflected in the snapshot
 * (or were previously applied) and must be skipped to avoid double-apply.
 */
export function shouldApply<T>(state: TopicState<T>, event: RealtimeEvent): boolean {
  if (typeof event.seq === 'number' && event.seq <= state.cursor) {
    return false;
  }
  if (event.id && state.appliedIds.has(event.id)) {
    return false;
  }
  return true;
}

/**
 * Idempotent merge reducer. Applies a single event to the topic state,
 * advancing the cursor and recording the event id for dedupe. Returns the
 * same state reference when the event is a no-op.
 */
export function applyEvent<T>(
  state: TopicState<T>,
  event: RealtimeEvent,
  reducer: (snapshot: T, event: RealtimeEvent) => T,
  options: MergeOptions = {},
): TopicState<T> {
  if (!shouldApply(state, event)) {
    return state;
  }

  const maxAppliedIds = options.maxAppliedIds ?? DEFAULT_MAX_APPLIED_IDS;
  const nextSnapshot = reducer(state.snapshot, event);
  const nextCursor =
    typeof event.seq === 'number' ? Math.max(state.cursor, event.seq) : state.cursor;

  const appliedIds = new Set(state.appliedIds);
  if (event.id) {
    appliedIds.add(event.id);
    if (appliedIds.size > maxAppliedIds) {
      const oldest = appliedIds.values().next().value;
      if (oldest !== undefined) {
        appliedIds.delete(oldest);
      }
    }
  }

  return { snapshot: nextSnapshot, cursor: nextCursor, appliedIds };
}

/**
 * Apply a batch of replayed events in order through the idempotent reducer.
 */
export function applyEvents<T>(
  state: TopicState<T>,
  events: RealtimeEvent[],
  reducer: (snapshot: T, event: RealtimeEvent) => T,
  options: MergeOptions = {},
): TopicState<T> {
  return events.reduce((acc, event) => applyEvent(acc, event, reducer, options), state);
}

/**
 * Decide whether a stored cursor is still usable for replay against a freshly
 * fetched snapshot cursor. If the gap is too large (or the snapshot cursor is
 * behind the stored cursor, indicating an unknown/rolled-back state), replay
 * is unavailable and the caller should fall back to a fresh snapshot with no
 * streamed delta.
 */
export function canReplay(
  storedCursor: number,
  snapshotCursor: number,
  options: MergeOptions = {},
): boolean {
  const maxReplayWindow = options.maxReplayWindow ?? DEFAULT_MAX_REPLAY_WINDOW;
  if (storedCursor > snapshotCursor) {
    return false;
  }
  return snapshotCursor - storedCursor <= maxReplayWindow;
}

/**
 * Snapshot-and-resume entry point. Given a freshly fetched REST snapshot and
 * the stored cursor, produce the topic state to resume from. When replay is
 * unavailable the state is reset to the snapshot with no streamed delta.
 */
export function resumeFromSnapshot<T>(
  snapshot: T,
  snapshotCursor: number,
  storedCursor: number | undefined,
  options: MergeOptions = {},
): TopicState<T> {
  if (storedCursor === undefined || !canReplay(storedCursor, snapshotCursor, options)) {
    return createTopicState(snapshot, snapshotCursor);
  }
  return createTopicState(snapshot, snapshotCursor);
}

/**
 * Merge polled REST and realtime values, preferring REST. Shadow comparisons
 * are recorded as a side effect but never influence the returned value.
 */
export function mergeValues<T extends Record<string, unknown>>(
  state: MergeState<T>,
  options: MergeOptions = {},
): T | null {
  const { shadow, topic, key } = options;

  if (shadow && topic && state.realtime) {
    shadow.record(
      topic,
      key ?? topic,
      state.realtime,
      state.polled ?? null,
    );
  }

  // REST is the known-good source of truth; realtime is only a fallback.
  return state.polled ?? state.realtime ?? null;
}
}

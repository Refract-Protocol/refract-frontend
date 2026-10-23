import type { RealtimeEvent } from './client';
import { ShadowMode, type ShadowTopic } from './shadow';

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

/**
 * Optional delta/patch frames for realtime topics. Full snapshots stay valid
 * at any time and supersede pending patches; patches carry a base revision so
 * the applier can reject gaps instead of corrupting state.
 *
 * Wire format uses keyed maps (never positional arrays). A `null` value in
 * `set` removes the key; nested plain objects are merged recursively.
 */

export const REALTIME_CONTRACT_VERSION = 2;

export interface SnapshotFrame<T = Record<string, unknown>> {
  kind: "snapshot";
  revision: number;
  data: T;
}

export interface PatchFrame {
  kind: "patch";
  base_revision: number;
  revision: number;
  set: Record<string, unknown>;
}

export type TopicFrame = SnapshotFrame | PatchFrame;

export interface TopicState<T = Record<string, unknown>> {
  revision: number;
  data: T;
}

export type PatchRejection = {
  rejected: true;
  reason: "no_base" | "revision_gap" | "stale" | "malformed";
  /** True when the caller should request a full snapshot resync. */
  resync: boolean;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function isTopicFrame(value: unknown): value is TopicFrame {
  if (!isPlainObject(value)) return false;
  if (value.kind === "snapshot") {
    return Number.isInteger(value.revision) && isPlainObject(value.data);
  }
  if (value.kind === "patch") {
    return (
      Number.isInteger(value.base_revision) &&
      Number.isInteger(value.revision) &&
      (value.revision as number) > (value.base_revision as number) &&
      isPlainObject(value.set)
    );
  }
  return false;
}

function mergeInto(
  target: Record<string, unknown>,
  set: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...target };
  for (const [key, value] of Object.entries(set)) {
    if (value === null) delete out[key];
    else if (isPlainObject(value) && isPlainObject(out[key]))
      out[key] = mergeInto(out[key] as Record<string, unknown>, value);
    else out[key] = value;
  }
  return out;
}

/** Pure patch applier: never mutates `state`, returns a new state or a rejection. */
export function applyPatch<T extends Record<string, unknown>>(
  state: TopicState<T> | null,
  patch: PatchFrame
): TopicState<T> | PatchRejection {
  if (!isTopicFrame(patch) || patch.kind !== "patch") {
    return { rejected: true, reason: "malformed", resync: false };
  }
  if (!state) return { rejected: true, reason: "no_base", resync: true };
  if (patch.revision <= state.revision) return { rejected: true, reason: "stale", resync: false };
  if (patch.base_revision !== state.revision)
    return { rejected: true, reason: "revision_gap", resync: true };
  return { revision: patch.revision, data: mergeInto(state.data, patch.set) as T };
}

/** Applies either frame form; snapshots with a lower revision than current are discarded. */
export function applyFrame<T extends Record<string, unknown>>(
  state: TopicState<T> | null,
  frame: TopicFrame
): TopicState<T> | PatchRejection {
  if (frame.kind === "snapshot") {
    if (state && frame.revision < state.revision)
      return { rejected: true, reason: "stale", resync: false };
    return { revision: frame.revision, data: frame.data as T };
  }
  return applyPatch(state, frame);
}

export const isRejection = (v: TopicState | PatchRejection): v is PatchRejection =>
  (v as PatchRejection).rejected === true;

/** Consumer-facing state holder: folds frames, emits data, signals resync. */
export function createTopicConsumer(
  onData: (data: Record<string, unknown>) => void,
  onResync: () => void
) {
  let state: TopicState | null = null;
  return {
    push(frame: unknown): void {
      if (!isTopicFrame(frame)) return;
      const result = applyFrame(state, frame);
      if (isRejection(result)) {
        if (result.resync) {
          state = null;
          onResync();
        }
        return;
      }
      state = result;
      onData(result.data);
    },
    reset(): void {
      state = null;
    },
  };
}

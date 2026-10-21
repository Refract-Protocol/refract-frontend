/**
 * Pure REST-snapshot + realtime-event reconciliation, independent of React and of
 * the transport. Hooks map `RealtimeMessage`s to `MergeEvent`s (version = contract
 * `ts`) and fold them with `reduce`.
 *
 * Rules: idempotent (an event whose version is not newer than what we hold for that
 * entity is dropped, so redelivery changes nothing); out-of-order safe (older events
 * are dropped); unknown ids are inserted; removals leave a tombstone so a stale
 * upsert cannot resurrect a removed entity. Unchanged state keeps its reference.
 */
export type MergeEvent<T> =
  | { type: "upsert"; id: string; version: number; data: T }
  | { type: "remove"; id: string; version: number };

export interface MergeState<T> {
  items: ReadonlyMap<string, { version: number; data: T }>;
  /** id → version at which the entity was removed. */
  tombstones: ReadonlyMap<string, number>;
}

export interface MergeConfig<T> {
  getId: (item: T) => string;
  getVersion: (item: T) => number;
}

export function createMerge<T>({ getId, getVersion }: MergeConfig<T>) {
  const init = (snapshot: readonly T[] = []): MergeState<T> => {
    const items = new Map<string, { version: number; data: T }>();
    for (const data of snapshot) {
      const id = getId(data);
      const version = getVersion(data);
      const cur = items.get(id);
      if (!cur || version > cur.version) items.set(id, { version, data });
    }
    return { items, tombstones: new Map() };
  };

  const reduce = (state: MergeState<T>, event: MergeEvent<T>): MergeState<T> => {
    const cur = state.items.get(event.id);
    const dead = state.tombstones.get(event.id);
    if (event.type === "upsert") {
      if ((cur && event.version <= cur.version) || (dead !== undefined && event.version <= dead))
        return state;
      const items = new Map(state.items);
      items.set(event.id, { version: event.version, data: event.data });
      let tombstones = state.tombstones;
      if (dead !== undefined) {
        const t = new Map(tombstones);
        t.delete(event.id);
        tombstones = t;
      }
      return { items, tombstones };
    }
    if ((cur && event.version < cur.version) || (dead !== undefined && event.version <= dead))
      return state;
    const items = new Map(state.items);
    items.delete(event.id);
    const tombstones = new Map(state.tombstones);
    tombstones.set(event.id, event.version);
    return { items, tombstones };
  };

  const applyAll = (state: MergeState<T>, events: Iterable<MergeEvent<T>>): MergeState<T> => {
    let s = state;
    for (const e of events) s = reduce(s, e);
    return s;
  };

  const view = (state: MergeState<T>): T[] => Array.from(state.items.values(), (e) => e.data);

  return { init, reduce, applyAll, view };
}

import type { OracleReading } from "@/lib/api/oracle";

/** An oracle reading as pushed on `oracle.readings`: `seq` is the per-coverage-type monotonic counter, `ts` the server timestamp (ms). */
export type StreamReading = OracleReading & { seq?: number; ts?: number };

/** Dedup key: one live reading per coverage type. */
const keyOf = (r: StreamReading) => r.coverageType;

function isNewer(incoming: StreamReading, current: StreamReading | undefined): boolean {
  if (!current) return true;
  if (incoming.seq !== undefined && current.seq !== undefined) return incoming.seq > current.seq;
  if (incoming.ts !== undefined && current.ts !== undefined) return incoming.ts > current.ts;
  return true;
}

/**
 * Pure merge of pushed readings into current state. Drops duplicates and
 * out-of-order/replayed frames (by `seq`, else `ts`) and returns the same
 * array reference when nothing changed so React can skip the re-render.
 */
export function mergeStreamReadings(
  current: StreamReading[],
  incoming: StreamReading[]
): StreamReading[] {
  const byKey = new Map(current.map((r) => [keyOf(r), r]));
  let changed = false;
  for (const reading of incoming) {
    const existing = byKey.get(keyOf(reading));
    if (!isNewer(reading, existing)) continue;
    if (existing && JSON.stringify(existing) === JSON.stringify(reading)) continue;
    // Keep the old position so the list doesn't reorder on every frame.
    byKey.set(keyOf(reading), reading);
    changed = true;
  }
  return changed ? Array.from(byKey.values()) : current;
}

/**
 * Applies a REST snapshot while preserving each key's seq/ts high-water mark,
 * so a replayed stream frame older than what REST already showed is still rejected.
 */
export function mergeRestReadings(
  current: StreamReading[],
  snapshot: OracleReading[]
): StreamReading[] {
  const prev = new Map(current.map((r) => [keyOf(r), r]));
  return snapshot.map((r) => {
    const p = prev.get(keyOf(r));
    return p && (p.seq !== undefined || p.ts !== undefined) ? { ...r, seq: p.seq, ts: p.ts } : r;
  });
}

/** Normalizes a frame payload (single reading or array) to a reading list, ignoring malformed entries. */
export function parseOraclePayload(payload: unknown): StreamReading[] {
  const list = Array.isArray(payload) ? payload : [payload];
  return list.filter(
    (r): r is StreamReading =>
      typeof r === "object" &&
      r !== null &&
      typeof (r as StreamReading).coverageType === "string" &&
      typeof (r as StreamReading).severity === "string"
  );
}

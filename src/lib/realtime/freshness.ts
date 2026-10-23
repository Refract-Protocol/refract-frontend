export interface FreshnessKey {
  sequence?: number;
  timestamp?: number;
  source: "rest" | "realtime";
}

/** `true` only when candidate is demonstrably newer; unorderable ties favor the current realtime value. */
export function isNewerUpdate(current: FreshnessKey | null, candidate: FreshnessKey): boolean {
  if (!current) return true;
  if (current.sequence !== undefined && candidate.sequence !== undefined)
    return candidate.sequence > current.sequence;
  if (current.timestamp !== undefined && candidate.timestamp !== undefined)
    return candidate.timestamp > current.timestamp;
  return current.source !== "realtime";
}

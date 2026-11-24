export interface FlagsDocument {
  flags: Record<string, boolean>;
}

/**
 * Documented default for any flag that is not present in the flags document.
 * Unknown flags resolve to this boolean rather than `undefined`.
 */
export const DEFAULT_FLAG_VALUE = false;

/** Safe default if the remote flags source is unreachable — new/risky features default off. */
export const DEFAULT_FLAGS: Record<string, boolean> = {
  /** Realtime WebSocket connection (src/lib/realtime). Off until the backend ships /ws. */
  realtime: false,
  /** Legacy alias for `realtime`, kept so existing flag documents still work. */
  "realtime-oracle": false,
  "realtime-soroban-events": false,
};

export const FLAGS_ENDPOINT = "/flags.json";
export const FLAGS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Reads a local override, e.g. NEXT_PUBLIC_FLAGS_OVERRIDE='{"realtime-oracle":true}'. */
export function readLocalOverride(): Record<string, boolean> | null {
  const raw = process.env.NEXT_PUBLIC_FLAGS_OVERRIDE;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return null;
  }
}

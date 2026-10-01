export interface FlagsDocument {
  flags: Record<string, boolean>;
}

/** Safe default if the remote flags source is unreachable — new/risky features default off. */
export const DEFAULT_FLAGS: Record<string, boolean> = {
  "realtime-oracle": false,
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

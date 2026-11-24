/**
 * Simple in-memory request cache used by src/lib/api/client.ts.
 *
 * Exposes hit/miss counters via getCacheStats() so cache effectiveness can be
 * measured (e.g. from the dev realtime inspector).
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

let hits = 0;
let misses = 0;

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

function isExpired(entry: CacheEntry<unknown>, now: number): boolean {
  return entry.expiresAt <= now;
}

export function getCached<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) {
    misses += 1;
    return undefined;
  }
  if (isExpired(entry, Date.now())) {
    store.delete(key);
    misses += 1;
    return undefined;
  }
  hits += 1;
  return entry.value as T;
}

export function setCached<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function clearCache(): void {
  store.clear();
}

export function getCacheStats(): CacheStats {
  return { hits, misses, size: store.size };
}

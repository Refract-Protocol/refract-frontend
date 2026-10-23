/**
 * In-memory, single-tab request dedup: concurrent and near-in-time callers for
 * the same key share one in-flight promise, and a settled success is reused
 * until `ttlMs` elapses. Failures are never cached. The key must include every
 * parameter that changes the response (e.g. `policies:${address}`).
 */
const DEFAULT_TTL_MS = 30_000;

interface Entry {
  promise: Promise<unknown>;
  timestamp: number;
}

const entries = new Map<string, Entry>();

export function cachedRequest<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = DEFAULT_TTL_MS
): Promise<T> {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.timestamp < ttlMs) return hit.promise as Promise<T>;

  const promise = fetcher();
  const entry: Entry = { promise, timestamp: Date.now() };
  entries.set(key, entry);
  promise.catch(() => {
    if (entries.get(key) === entry) entries.delete(key);
  });
  return promise;
}

export function clearRequestCache(key?: string): void {
  if (key === undefined) entries.clear();
  else entries.delete(key);
}

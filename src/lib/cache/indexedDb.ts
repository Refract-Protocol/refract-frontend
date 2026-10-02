/**
 * Tiny IndexedDB-backed key/value cache for the Dashboard's GET-driven hooks
 * (stale-while-revalidate). Every operation degrades to a no-op/null when
 * IndexedDB is unavailable (SSR, private browsing, disabled storage) so
 * callers fall back to plain always-fetch-fresh behavior and never crash.
 *
 * Callers must namespace keys by wallet address (see `walletCacheKey`) so
 * one address's cached data is never served to another.
 */
const DB_NAME = "refract-cache";
const STORE = "entries";
const DB_VERSION = 1;

export interface CacheRecord<T> {
  key: string;
  data: T;
  timestamp: number;
}

/** Default threshold after which cached data is flagged as potentially stale. */
export const STALE_AFTER_MS = 5 * 60_000;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<R>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<R | null> {
  return openDb().then(
    (db) =>
      new Promise<R | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = op(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve((req.result as R) ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export function walletCacheKey(address: string, resource: string): string {
  return `${address}:${resource}`;
}

/** Returns the cached record, or null if missing, expired (older than maxAgeMs), or IndexedDB is unavailable. */
export async function cacheGet<T>(key: string, maxAgeMs = Infinity, now = Date.now()): Promise<CacheRecord<T> | null> {
  const record = await run<CacheRecord<T>>("readonly", (s) => s.get(key));
  if (!record) return null;
  if (now - record.timestamp > maxAgeMs) {
    await cacheDelete(key);
    return null;
  }
  return record;
}

export async function cacheSet<T>(key: string, data: T, now = Date.now()): Promise<void> {
  await run("readwrite", (s) => s.put({ key, data, timestamp: now } satisfies CacheRecord<T>));
}

export async function cacheDelete(key: string): Promise<void> {
  await run("readwrite", (s) => s.delete(key));
}

/** Test-only: forget the open connection so a fresh (fake) IndexedDB is picked up. */
export function resetCacheConnection(): void {
  dbPromise = null;
}

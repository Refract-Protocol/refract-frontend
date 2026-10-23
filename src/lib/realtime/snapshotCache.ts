"use client";

export interface Snapshot<T> { value: T; capturedAt: number; version: number; stale: true }
const DB_NAME = "refract-realtime-snapshots";
const STORE = "snapshots";
const VERSION = 1;
const pending = new Map<string, { entry: Snapshot<unknown>; timer: ReturnType<typeof setTimeout> }>();
const memory = new Map<string, Snapshot<unknown>>();

function scopedKey(topic: string, network: string, wallet = "public") {
  return `${network}:${wallet.toLowerCase()}:${topic}`;
}
const mirrorKey = (key: string) => `refract:realtime:${key}`;

/** A tiny synchronous seed mirror lets client renders paint before IndexedDB opens. */
export function readSnapshotSync<T>(topic: string, network: string, wallet?: string, version = VERSION): Snapshot<T> | null {
  if (typeof window === "undefined") return null;
  const key = scopedKey(topic, network, wallet);
  const warmed = memory.get(key) as Snapshot<T> | undefined;
  if (warmed) return warmed.version === version ? { ...warmed, stale: true } : null;
  try {
    const raw = window.localStorage.getItem(mirrorKey(key));
    if (!raw) return null;
    const entry = JSON.parse(raw) as Snapshot<T>;
    if (entry.version !== version) {
      window.localStorage.removeItem(mirrorKey(key));
      return null;
    }
    memory.set(key, entry);
    return { ...entry, stale: true };
  } catch { return null; }
}
function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function readSnapshot<T>(topic: string, network: string, wallet?: string, version = VERSION): Promise<Snapshot<T> | null> {
  if (typeof window === "undefined") return null;
  const key = scopedKey(topic, network, wallet);
  let value: Snapshot<T> | null = (memory.get(key) as Snapshot<T> | undefined) ?? null;
  const db = await openDb();
  if (db) {
    const persisted = await new Promise<Snapshot<T> | null>((resolve) => {
    try {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => {
        const stored = req.result;
        const entry = stored?.entry as Snapshot<T> | undefined;
        if (entry && entry.version !== version) {
          try { db.transaction(STORE, "readwrite").objectStore(STORE).delete(key); } catch { /* optional cache */ }
          memory.delete(key);
          resolve(null);
        } else resolve(entry ?? null);
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
    });
    if (!value || (persisted && persisted.capturedAt > value.capturedAt)) value = persisted;
  }
  if (value && value.version !== version) { await deleteSnapshot(topic, network, wallet); return null; }
  return value ? { ...value, stale: true } : null;
}

export function writeSnapshot<T>(topic: string, network: string, value: T, wallet?: string, version = VERSION): void {
  if (typeof window === "undefined") return;
  const key = scopedKey(topic, network, wallet);
  const entry: Snapshot<T> = { value, capturedAt: Date.now(), version, stale: true };
  memory.set(key, entry);
  try { window.localStorage.setItem(mirrorKey(key), JSON.stringify(entry)); } catch { /* optional sync seed */ }
  const previous = pending.get(key);
  if (previous) { clearTimeout(previous.timer); previous.entry = entry; previous.timer = setTimeout(() => void flush(key), 300); }
  else pending.set(key, { entry, timer: setTimeout(() => void flush(key), 300) });
}

async function flush(key: string) {
  const item = pending.get(key); if (!item) return;
  pending.delete(key);
  const db = await openDb(); if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ key, entry: item.entry });
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Snapshot write failed"));
    });
  } catch {
    // Quota pressure: remove the oldest entry, then retry once. Cache failure
    // must never affect the realtime data path.
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          const first = { key: cursor.key, capturedAt: cursor.value?.entry?.capturedAt ?? 0 };
          let oldest = first;
          const scan = store.openCursor();
          scan.onsuccess = () => {
            const next = scan.result;
            if (next) {
              const capturedAt = next.value?.entry?.capturedAt ?? 0;
              if (capturedAt < oldest.capturedAt) oldest = { key: next.key, capturedAt };
              next.continue();
            } else {
              store.delete(oldest.key);
              store.put({ key, entry: item.entry });
            }
          };
        }
      };
    } catch { /* storage is optional */ }
  }
}

export async function deleteSnapshot(topic: string, network: string, wallet?: string): Promise<void> {
  const key = scopedKey(topic, network, wallet); memory.delete(key);
  try { window.localStorage.removeItem(mirrorKey(key)); } catch { /* optional cache */ }
  const db = await openDb(); if (!db) return;
  try { db.transaction(STORE, "readwrite").objectStore(STORE).delete(key); } catch { /* storage is optional */ }
}

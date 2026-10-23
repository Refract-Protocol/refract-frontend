export interface CachedValue<T = unknown> {
  value: T;
  /** Epoch ms when the value was received. */
  receivedAt: number;
  source: string;
  sequence: number;
}

export interface LastValueCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  now?: () => number;
}

export const DEFAULT_MAX_ENTRIES = 64;
export const DEFAULT_TTL_MS = 60_000;

export function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase();
}

/**
 * Bounded latest-value-only store, one entry per topic. Entries past the TTL
 * are evicted on read; the oldest-inserted entry is evicted when full.
 */
export class LastValueCache {
  private entries = new Map<string, CachedValue>();
  private seq = 0;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor({
    maxEntries = DEFAULT_MAX_ENTRIES,
    ttlMs = DEFAULT_TTL_MS,
    now = Date.now,
  }: LastValueCacheOptions = {}) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  set(topic: string, value: unknown, source = "ws", sequence?: number): void {
    const key = normalizeTopic(topic);
    this.entries.delete(key); // re-insert so Map order tracks recency
    this.entries.set(key, {
      value,
      receivedAt: this.now(),
      source,
      sequence: sequence ?? ++this.seq,
    });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }

  get<T = unknown>(topic: string): CachedValue<T> | undefined {
    const key = normalizeTopic(topic);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.receivedAt > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry as CachedValue<T>;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

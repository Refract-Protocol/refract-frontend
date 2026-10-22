export interface DedupeOptions {
  /**
   * Max ids remembered per topic. Size it as
   * (peak events/sec for the topic) × (longest replay window after a reconnect).
   * The default covers ~50 events/sec over a 40s replay window.
   */
  maxEntriesPerTopic?: number;
  /** Ids older than this are forgotten, so a genuinely re-emitted event is processed again. */
  ttlMs?: number;
  now?: () => number;
}

export type DedupeVerdict = "fresh" | "duplicate" | "untracked";

export interface DedupeStats {
  /** Events dropped because their id was already seen. */
  duplicatesDropped: number;
  /** Events passed through without de-duplication because they had no id. */
  missingId: number;
  perTopic: Record<string, { duplicatesDropped: number; missingId: number }>;
}

/**
 * Bounded recently-seen-id set, one LRU+TTL window per topic.
 *
 * Transport-agnostic: the realtime client owns one instance and runs every
 * inbound event through it, whichever transport delivered it. State lives in
 * memory only, so a page reload always starts clean.
 */
export class DedupeCache {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  /** Map preserves insertion order, which doubles as LRU order. */
  private seen = new Map<string, Map<string, number>>();
  private stats: DedupeStats = emptyStats();

  constructor(options: DedupeOptions = {}) {
    this.maxEntries = options.maxEntriesPerTopic ?? 2_000;
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.now = options.now ?? (() => Date.now());
  }

  check(topic: string, id: string | undefined): DedupeVerdict {
    if (!id) {
      this.bump(topic, "missingId");
      return "untracked";
    }

    const now = this.now();
    let window = this.seen.get(topic);
    if (!window) {
      window = new Map();
      this.seen.set(topic, window);
    }
    this.evictExpired(window, now);

    const seenAt = window.get(id);
    if (seenAt !== undefined) {
      this.bump(topic, "duplicatesDropped");
      return "duplicate";
    }

    window.set(id, now);
    if (window.size > this.maxEntries) {
      const oldest = window.keys().next().value;
      if (oldest !== undefined) window.delete(oldest);
    }
    return "fresh";
  }

  /** Forget all ids, e.g. on account or network switch. Counters are kept. */
  reset(): void {
    this.seen.clear();
  }

  resetStats(): void {
    this.stats = emptyStats();
  }

  getStats(): DedupeStats {
    return {
      duplicatesDropped: this.stats.duplicatesDropped,
      missingId: this.stats.missingId,
      perTopic: Object.fromEntries(
        Object.entries(this.stats.perTopic).map(([topic, s]) => [topic, { ...s }])
      ),
    };
  }

  /** Number of ids currently remembered for a topic (for tests and diagnostics). */
  size(topic: string): number {
    return this.seen.get(topic)?.size ?? 0;
  }

  private evictExpired(window: Map<string, number>, now: number): void {
    // Insertion order ≈ time order, so stop at the first unexpired entry.
    for (const [id, seenAt] of window) {
      if (now - seenAt < this.ttlMs) break;
      window.delete(id);
    }
  }

  private bump(topic: string, key: "duplicatesDropped" | "missingId"): void {
    this.stats[key] += 1;
    const t = (this.stats.perTopic[topic] ??= { duplicatesDropped: 0, missingId: 0 });
    t[key] += 1;
  }
}

function emptyStats(): DedupeStats {
  return { duplicatesDropped: 0, missingId: 0, perTopic: {} };
}

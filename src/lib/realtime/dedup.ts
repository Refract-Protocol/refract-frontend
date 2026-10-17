export const DEFAULT_DEDUP_WINDOW_SIZE = 1_024;
export const DEFAULT_DEDUP_TTL_MS = 5 * 60 * 1_000;

export interface DeduplicatableFrame {
  topic: string;
  id?: string | null;
  seq?: number | null;
  payload?: unknown;
}

export type DedupeDecision =
  | { accepted: true; reason: "new" | "missing_id" }
  | { accepted: false; reason: "duplicate_id" };

export interface TopicDedupeStats {
  topic: string;
  cachedIds: number;
  acceptedCount: number;
  duplicateDrops: number;
  missingIdCount: number;
  lastSeq: number | null;
}

export interface DedupeCacheStats {
  totalAccepted: number;
  totalDuplicateDrops: number;
  totalMissingIds: number;
  byTopic: Record<string, TopicDedupeStats>;
}

export interface DedupeCacheOptions {
  /** Maximum number of recent event IDs retained per topic (LRU cap, default: 1024). */
  maxEntriesPerTopic?: number;
  /** Time-to-live (ms) before a seen event ID expires from the window (default: 5 minutes). */
  ttlMs?: number;
  /** Injectable clock for deterministic testing. */
  now?: () => number;
}

interface TopicWindow {
  /** Map from `id -> seenAtTimestamp` maintaining insertion/LRU order. */
  entries: Map<string, number>;
  acceptedCount: number;
  duplicateDrops: number;
  missingIdCount: number;
  lastSeq: number | null;
}

/**
 * Transport-agnostic per-topic event-ID deduplication cache (bounded LRU + TTL)
 * shared across WebSocket, SSE, and long-poll transports. Ensures replayed or
 * retried frames are applied at most once within the retention window while
 * passing through synthetic un-IDed frames with a diagnostic counter.
 */
export class DedupeCache {
  private readonly maxEntriesPerTopic: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly windows = new Map<string, TopicWindow>();

  constructor(options: DedupeCacheOptions = {}) {
    this.maxEntriesPerTopic = Math.max(1, options.maxEntriesPerTopic ?? DEFAULT_DEDUP_WINDOW_SIZE);
    this.ttlMs = Math.max(1, options.ttlMs ?? DEFAULT_DEDUP_TTL_MS);
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Checks whether `frame` should be delivered to topic subscribers and records
   * its `id` in the bounded per-topic LRU+TTL window.
   */
  shouldDeliver(frame: DeduplicatableFrame): DedupeDecision {
    const window = this.getOrCreateWindow(frame.topic);
    const currentTime = this.now();

    this.evictExpired(window, currentTime);

    const rawId = typeof frame.id === "string" ? frame.id.trim() : "";
    if (!rawId) {
      window.missingIdCount += 1;
      window.acceptedCount += 1;
      if (typeof frame.seq === "number" && Number.isFinite(frame.seq)) {
        window.lastSeq =
          window.lastSeq === null ? frame.seq : Math.max(window.lastSeq, frame.seq);
      }
      return { accepted: true, reason: "missing_id" };
    }

    const seenAt = window.entries.get(rawId);
    if (seenAt !== undefined && currentTime - seenAt <= this.ttlMs) {
      // Refresh LRU position on duplicate hit
      window.entries.delete(rawId);
      window.entries.set(rawId, currentTime);
      window.duplicateDrops += 1;
      return { accepted: false, reason: "duplicate_id" };
    }

    window.entries.delete(rawId);
    window.entries.set(rawId, currentTime);

    while (window.entries.size > this.maxEntriesPerTopic) {
      const oldestKey = window.entries.keys().next().value;
      if (oldestKey === undefined) break;
      window.entries.delete(oldestKey);
    }

    window.acceptedCount += 1;
    if (typeof frame.seq === "number" && Number.isFinite(frame.seq)) {
      window.lastSeq =
        window.lastSeq === null ? frame.seq : Math.max(window.lastSeq, frame.seq);
    }

    return { accepted: true, reason: "new" };
  }

  /**
   * Filters a batch/stream of frames in order, returning only non-duplicate frames.
   */
  filterBatch<T extends DeduplicatableFrame>(frames: Iterable<T>): T[] {
    const out: T[] = [];
    for (const frame of frames) {
      if (this.shouldDeliver(frame).accepted) {
        out.push(frame);
      }
    }
    return out;
  }

  private getOrCreateWindow(topic: string): TopicWindow {
    let win = this.windows.get(topic);
    if (!win) {
      win = {
        entries: new Map(),
        acceptedCount: 0,
        duplicateDrops: 0,
        missingIdCount: 0,
        lastSeq: null,
      };
      this.windows.set(topic, win);
    }
    return win;
  }

  private evictExpired(window: TopicWindow, currentTime: number): void {
    for (const [id, seenAt] of window.entries.entries()) {
      if (currentTime - seenAt > this.ttlMs) {
        window.entries.delete(id);
      } else {
        // Entries are ordered from oldest to newest
        break;
      }
    }
  }

  /**
   * Clears deduplication state for a single topic or for the entire connection
   * (e.g. on Stellar account or network switch).
   */
  reset(topic?: string): void {
    if (topic) {
      this.windows.delete(topic);
      return;
    }
    this.windows.clear();
  }

  getStats(): DedupeCacheStats {
    const currentTime = this.now();
    let totalAccepted = 0;
    let totalDuplicateDrops = 0;
    let totalMissingIds = 0;
    const byTopic: Record<string, TopicDedupeStats> = {};

    for (const [topic, win] of this.windows.entries()) {
      this.evictExpired(win, currentTime);
      totalAccepted += win.acceptedCount;
      totalDuplicateDrops += win.duplicateDrops;
      totalMissingIds += win.missingIdCount;
      byTopic[topic] = {
        topic,
        cachedIds: win.entries.size,
        acceptedCount: win.acceptedCount,
        duplicateDrops: win.duplicateDrops,
        missingIdCount: win.missingIdCount,
        lastSeq: win.lastSeq,
      };
    }

    return {
      totalAccepted,
      totalDuplicateDrops,
      totalMissingIds,
      byTopic,
    };
  }
}

export const realtimeDedupeCache = new DedupeCache();

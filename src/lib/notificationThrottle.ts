export type ToastPriority = "critical" | "normal" | "low";

export interface ToastItem {
  id: string;
  priority: ToastPriority;
  title: string;
}

export interface ThrottleOptions {
  maxConcurrent: number;
  maxPerWindow: number;
  windowMs: number;
  /** Local hours [start, end) during which non-critical items are deferred; start > end wraps midnight. */
  quietHours?: { start: number; end: number } | null;
  now?: () => number;
}

export interface ThrottleState {
  visible: ToastItem[];
  /** Overflow count shown as a "+N more" summary toast. */
  overflow: number;
  /** Overflowed items, so the summary toast can expand. */
  overflowItems: ToastItem[];
  /** Queued by quiet hours, never dropped. */
  deferred: ToastItem[];
}

function inQuietHours(hour: number, q: { start: number; end: number }): boolean {
  return q.start <= q.end ? hour >= q.start && hour < q.end : hour >= q.start || hour < q.end;
}

/**
 * Presentation-only limiter placed in front of toast rendering: notification
 * state stays complete, only what is shown as a toast is capped. Critical items
 * (settlement/claim confirmations) bypass every cap and quiet hours.
 */
export class ToastLimiter {
  private seen = new Set<string>();
  private stamps: number[] = [];
  private state: ThrottleState = { visible: [], overflow: 0, overflowItems: [], deferred: [] };
  private listeners = new Set<(s: ThrottleState) => void>();

  constructor(private opts: ThrottleOptions) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private emit(): void {
    this.state = { ...this.state };
    this.listeners.forEach((l) => l(this.state));
  }

  getState(): ThrottleState {
    return this.state;
  }

  subscribe(listener: (s: ThrottleState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Returns false when the item was a duplicate (e.g. same event via realtime and REST). */
  push(item: ToastItem): boolean {
    if (this.seen.has(item.id)) return false;
    this.seen.add(item.id);

    const critical = item.priority === "critical";
    const q = this.opts.quietHours;
    if (!critical && q && inQuietHours(new Date(this.now()).getHours(), q)) {
      this.state.deferred = [...this.state.deferred, item];
      this.emit();
      return true;
    }
    this.show(item);
    this.emit();
    return true;
  }

  private show(item: ToastItem): void {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < this.opts.windowMs);
    const critical = item.priority === "critical";
    const rateOk = this.stamps.length < this.opts.maxPerWindow;

    if (critical || rateOk) {
      this.stamps.push(t);
      let visible = [...this.state.visible, item];
      if (visible.length > this.opts.maxConcurrent) {
        // Evict the lowest-priority, oldest non-critical toast into the summary.
        const rank = { low: 0, normal: 1, critical: 2 } as const;
        const evictable = visible
          .filter((v) => v.priority !== "critical")
          .sort((a, b) => rank[a.priority] - rank[b.priority])[0];
        if (evictable) {
          visible = visible.filter((v) => v !== evictable);
          this.toOverflow(evictable);
        }
      }
      this.state.visible = visible;
    } else {
      this.toOverflow(item);
    }
  }

  private toOverflow(item: ToastItem): void {
    this.state.overflowItems = [...this.state.overflowItems, item];
    this.state.overflow = this.state.overflowItems.length;
  }

  dismiss(id: string): void {
    this.state.visible = this.state.visible.filter((v) => v.id !== id);
    this.emit();
  }

  clearOverflow(): void {
    this.state.overflowItems = [];
    this.state.overflow = 0;
    this.emit();
  }

  /** Releases deferred items (quiet hours ended / user opened the deferred view). */
  flushDeferred(): ToastItem[] {
    const out = this.state.deferred;
    this.state.deferred = [];
    this.emit();
    return out;
  }

  /** Account switch: drop limiter memory so the new account starts clean. */
  reset(): void {
    this.seen.clear();
    this.stamps = [];
    this.state = { visible: [], overflow: 0, overflowItems: [], deferred: [] };
    this.emit();
  }
}

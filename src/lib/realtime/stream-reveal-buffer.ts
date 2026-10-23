export interface StreamedFeedItem {
  id: string;
  timestampMs: number;
}

export interface StreamRevealControlState<T extends StreamedFeedItem> {
  visibleItems: T[];
  pendingCount: number;
  showRevealBanner: boolean;
  revealBannerLabel: string;
  animateReveal: boolean;
}

export interface StreamRevealBufferOptions {
  maxBufferSize?: number;
  maxVisibleSize?: number;
  prefersReducedMotion?: boolean;
}

/**
 * Buffers incoming streamed feed items when the user is scrolled down or in a background tab,
 * preventing mid-read scroll jumps while surfacing a "New Updates Available" reveal control.
 */
export class StreamRevealBuffer<T extends StreamedFeedItem> {
  private readonly visibleById = new Map<string, T>();
  private readonly pendingById = new Map<string, T>();
  private readonly maxBufferSize: number;
  private readonly maxVisibleSize: number;
  private prefersReducedMotion: boolean;
  private scrolledToTop = true;
  private tabVisible = true;

  constructor(
    initialItems: readonly T[] = [],
    options: StreamRevealBufferOptions = {}
  ) {
    this.maxBufferSize = options.maxBufferSize ?? 200;
    this.maxVisibleSize = options.maxVisibleSize ?? 500;
    this.prefersReducedMotion = options.prefersReducedMotion ?? false;
    for (const item of initialItems) {
      this.visibleById.set(item.id, item);
    }
    this.trimVisible();
  }

  setScrollPosition(isScrolledToTop: boolean): void {
    this.scrolledToTop = isScrolledToTop;
  }

  setTabVisibility(isVisible: boolean): void {
    this.tabVisible = isVisible;
  }

  setReducedMotion(reduced: boolean): void {
    this.prefersReducedMotion = reduced;
  }

  /**
   * Pushes an incoming streamed item. Auto-reveals if the user is at the top of a visible tab;
   * otherwise queues into the bounded pending buffer.
   */
  pushIncoming(item: T): StreamRevealControlState<T> {
    if (this.visibleById.has(item.id) || this.pendingById.has(item.id)) {
      return this.getState();
    }

    if (this.scrolledToTop && this.tabVisible && this.pendingById.size === 0) {
      this.visibleById.set(item.id, item);
      this.trimVisible();
      return this.getState();
    }

    this.pendingById.set(item.id, item);
    this.trimPending();
    return this.getState();
  }

  /**
   * Commits all buffered items into the visible list in descending timestamp order.
   */
  revealPending(): StreamRevealControlState<T> {
    for (const [id, item] of this.pendingById.entries()) {
      if (!this.visibleById.has(id)) {
        this.visibleById.set(id, item);
      }
    }
    this.pendingById.clear();
    this.trimVisible();
    return this.getState();
  }

  getState(): StreamRevealControlState<T> {
    const visibleItems = Array.from(this.visibleById.values()).sort(
      (a, b) => b.timestampMs - a.timestampMs || a.id.localeCompare(b.id)
    );
    const pendingCount = this.pendingById.size;

    return {
      visibleItems,
      pendingCount,
      showRevealBanner: pendingCount > 0,
      revealBannerLabel:
        pendingCount === 1
          ? '1 new update available'
          : `${pendingCount} new updates available`,
      animateReveal: !this.prefersReducedMotion && pendingCount > 0,
    };
  }

  private trimPending(): void {
    if (this.pendingById.size <= this.maxBufferSize) return;
    const sortedOldestFirst = Array.from(this.pendingById.values()).sort(
      (a, b) => a.timestampMs - b.timestampMs
    );
    const excess = this.pendingById.size - this.maxBufferSize;
    for (let i = 0; i < excess; i++) {
      this.pendingById.delete(sortedOldestFirst[i].id);
    }
  }

  private trimVisible(): void {
    if (this.visibleById.size <= this.maxVisibleSize) return;
    const sortedOldestFirst = Array.from(this.visibleById.values()).sort(
      (a, b) => a.timestampMs - b.timestampMs
    );
    const excess = this.visibleById.size - this.maxVisibleSize;
    for (let i = 0; i < excess; i++) {
      this.visibleById.delete(sortedOldestFirst[i].id);
    }
  }
}

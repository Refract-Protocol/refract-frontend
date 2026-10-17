export interface VirtualWindowConfig {
  viewportHeightPx: number;
  defaultRowHeightPx: number;
  overscanCount?: number;
}

export interface VirtualRenderedRow<T> {
  index: number;
  item: T;
  offsetTopPx: number;
  heightPx: number;
  isFocused: boolean;
}

export interface VirtualWindowSnapshot<T> {
  totalCount: number;
  totalHeightPx: number;
  startIndex: number;
  endIndex: number;
  paddingTopPx: number;
  paddingBottomPx: number;
  renderedRows: VirtualRenderedRow<T>[];
  isAtTop: boolean;
  isAtBottom: boolean;
  scrollTopPx: number;
}

/**
 * Zero-dependency windowing engine for high-volume realtime feeds that keeps
 * DOM render cost flat across thousands of items while preserving scroll anchoring and focus.
 */
export class VirtualizedStreamWindow<T extends { id: string }> {
  private readonly viewportHeightPx: number;
  private readonly defaultRowHeightPx: number;
  private readonly overscanCount: number;
  private readonly measuredHeights = new Map<string, number>();
  private items: T[] = [];
  private scrollTopPx = 0;
  private focusedItemId: string | null = null;

  constructor(config: VirtualWindowConfig) {
    this.viewportHeightPx = Math.max(1, config.viewportHeightPx);
    this.defaultRowHeightPx = Math.max(1, config.defaultRowHeightPx);
    this.overscanCount = Math.max(0, config.overscanCount ?? 4);
  }

  setItems(nextItems: readonly T[]): void {
    this.items = [...nextItems];
  }

  /**
   * Prepends new streamed items at the top of the feed and adjusts `scrollTopPx`
   * when the user is scrolled down so the visible viewport remains anchored.
   */
  prependItems(newItems: readonly T[]): number {
    if (newItems.length === 0) return this.scrollTopPx;

    const wasScrolledDown = this.scrollTopPx > 0;
    let addedHeightPx = 0;
    for (const item of newItems) {
      addedHeightPx += this.getRowHeight(item.id);
    }

    this.items = [...newItems, ...this.items];
    if (wasScrolledDown) {
      this.scrollTopPx += addedHeightPx;
    }

    return this.scrollTopPx;
  }

  measureRowHeight(itemId: string, heightPx: number): void {
    if (heightPx > 0 && Number.isFinite(heightPx)) {
      this.measuredHeights.set(itemId, heightPx);
    }
  }

  setScrollTop(scrollTopPx: number): void {
    this.scrollTopPx = Math.max(0, scrollTopPx);
  }

  setFocusedItemId(itemId: string | null): void {
    this.focusedItemId = itemId;
  }

  getSnapshot(): VirtualWindowSnapshot<T> {
    const totalCount = this.items.length;
    if (totalCount === 0) {
      return {
        totalCount: 0,
        totalHeightPx: 0,
        startIndex: 0,
        endIndex: -1,
        paddingTopPx: 0,
        paddingBottomPx: 0,
        renderedRows: [],
        isAtTop: true,
        isAtBottom: true,
        scrollTopPx: 0,
      };
    }

    const offsets = new Array<number>(totalCount);
    const heights = new Array<number>(totalCount);
    let runningOffset = 0;

    for (let i = 0; i < totalCount; i++) {
      offsets[i] = runningOffset;
      const h = this.getRowHeight(this.items[i].id);
      heights[i] = h;
      runningOffset += h;
    }

    const totalHeightPx = runningOffset;
    const clampedScrollTop = Math.min(
      this.scrollTopPx,
      Math.max(0, totalHeightPx - this.viewportHeightPx)
    );
    const viewportBottom = clampedScrollTop + this.viewportHeightPx;

    let firstVisible = 0;
    while (
      firstVisible < totalCount - 1 &&
      offsets[firstVisible] + heights[firstVisible] <= clampedScrollTop
    ) {
      firstVisible += 1;
    }

    let lastVisible = firstVisible;
    while (
      lastVisible < totalCount - 1 &&
      offsets[lastVisible] < viewportBottom
    ) {
      lastVisible += 1;
    }

    const startIndex = Math.max(0, firstVisible - this.overscanCount);
    const endIndex = Math.min(totalCount - 1, lastVisible + this.overscanCount);

    const renderedRows: VirtualRenderedRow<T>[] = [];
    for (let i = startIndex; i <= endIndex; i++) {
      const item = this.items[i];
      renderedRows.push({
        index: i,
        item,
        offsetTopPx: offsets[i],
        heightPx: heights[i],
        isFocused: item.id === this.focusedItemId,
      });
    }

    // Ensure focused item stays mounted for keyboard accessibility even if scrolled outside window
    if (this.focusedItemId) {
      const focusedIdx = this.items.findIndex((it) => it.id === this.focusedItemId);
      if (focusedIdx !== -1 && (focusedIdx < startIndex || focusedIdx > endIndex)) {
        renderedRows.push({
          index: focusedIdx,
          item: this.items[focusedIdx],
          offsetTopPx: offsets[focusedIdx],
          heightPx: heights[focusedIdx],
          isFocused: true,
        });
        renderedRows.sort((a, b) => a.index - b.index);
      }
    }

    const paddingTopPx = offsets[startIndex];
    const endBottomPx = offsets[endIndex] + heights[endIndex];
    const paddingBottomPx = Math.max(0, totalHeightPx - endBottomPx);

    return {
      totalCount,
      totalHeightPx,
      startIndex,
      endIndex,
      paddingTopPx,
      paddingBottomPx,
      renderedRows,
      isAtTop: clampedScrollTop <= 2,
      isAtBottom: clampedScrollTop + this.viewportHeightPx >= totalHeightPx - 2,
      scrollTopPx: clampedScrollTop,
    };
  }

  private getRowHeight(itemId: string): number {
    return this.measuredHeights.get(itemId) ?? this.defaultRowHeightPx;
  }
}

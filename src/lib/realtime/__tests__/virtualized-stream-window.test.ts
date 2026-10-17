import { describe, expect, it } from 'vitest';
import { VirtualizedStreamWindow } from '../virtualized-stream-window';

describe('VirtualizedStreamWindow', () => {
  it('keeps rendered row count flat for a synthetic feed of 10,000 items', () => {
    const win = new VirtualizedStreamWindow<{ id: string }>({
      viewportHeightPx: 400,
      defaultRowHeightPx: 50,
      overscanCount: 3,
    });

    const items = Array.from({ length: 10_000 }, (_, i) => ({ id: `row-${i}` }));
    win.setItems(items);
    win.setScrollTop(25_000);

    const snapshot = win.getSnapshot();
    expect(snapshot.totalCount).toBe(10_000);
    expect(snapshot.totalHeightPx).toBe(500_000);
    // 400px / 50px = 8 visible rows + 3 overscan top + 3 overscan bottom = 14 rows max
    expect(snapshot.renderedRows.length).toBeLessThanOrEqual(15);
    expect(snapshot.isAtTop).toBe(false);
    expect(snapshot.isAtBottom).toBe(false);
  });

  it('anchors scroll position when new streamed items are prepended while scrolled down', () => {
    const win = new VirtualizedStreamWindow<{ id: string }>({
      viewportHeightPx: 200,
      defaultRowHeightPx: 40,
      overscanCount: 1,
    });

    win.setItems(Array.from({ length: 50 }, (_, i) => ({ id: `item-${i}` })));
    win.setScrollTop(400); // Viewing starting at item-10

    const beforeFirstVisible = win.getSnapshot().renderedRows.find(
      (r) => r.offsetTopPx >= 400
    );
    expect(beforeFirstVisible?.item.id).toBe('item-10');

    // Prepend 3 new streamed items (3 * 40 = 120px)
    const anchoredScrollTop = win.prependItems([
      { id: 'new-1' },
      { id: 'new-2' },
      { id: 'new-3' },
    ]);
    expect(anchoredScrollTop).toBe(520);

    const afterFirstVisible = win.getSnapshot().renderedRows.find(
      (r) => r.offsetTopPx >= anchoredScrollTop
    );
    expect(afterFirstVisible?.item.id).toBe('item-10');
  });

  it('retains focused row in rendered output even when scrolled outside the overscan window', () => {
    const win = new VirtualizedStreamWindow<{ id: string }>({
      viewportHeightPx: 100,
      defaultRowHeightPx: 50,
      overscanCount: 1,
    });

    win.setItems(Array.from({ length: 100 }, (_, i) => ({ id: `r-${i}` })));
    win.setFocusedItemId('r-0');
    win.setScrollTop(2_500);

    const snapshot = win.getSnapshot();
    expect(snapshot.renderedRows.some((r) => r.item.id === 'r-0' && r.isFocused)).toBe(true);
  });
});

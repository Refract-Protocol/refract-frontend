export interface VirtualWindow {
  start: number;
  end: number; // exclusive
  offsetTop: number;
  totalHeight: number;
}

/** Computes the rendered slice for a fixed-row-height list with overscan. */
export function computeWindow(
  count: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = 4,
): VirtualWindow {
  if (count <= 0 || rowHeight <= 0) return { start: 0, end: 0, offsetTop: 0, totalHeight: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(viewportHeight / rowHeight);
  const start = Math.min(Math.max(0, first - overscan), count - 1);
  const end = Math.min(count, first + visible + overscan);
  return { start, end: Math.max(end, start + 1), offsetTop: start * rowHeight, totalHeight: count * rowHeight };
}

/**
 * Scrolls the container so the row at `index` is visible, keeping a small
 * margin above/below. Used to bring off-screen rows into view when keyboard
 * focus moves to them in a virtualized list.
 */
export function scrollIndexIntoView(
  container: HTMLElement | null,
  index: number,
  rowHeight: number,
  margin = 1,
): void {
  if (!container || rowHeight <= 0 || index < 0) return;
  const rowTop = index * rowHeight;
  const rowBottom = rowTop + rowHeight;
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;
  if (rowTop < viewTop + margin * rowHeight) {
    container.scrollTop = Math.max(0, rowTop - margin * rowHeight);
  } else if (rowBottom > viewBottom - margin * rowHeight) {
    container.scrollTop = rowBottom - container.clientHeight + margin * rowHeight;
  }
}

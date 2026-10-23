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

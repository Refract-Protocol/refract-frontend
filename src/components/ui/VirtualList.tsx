"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { computeWindow } from "@/lib/virtualWindow";

interface VirtualListProps<T> {
  items: T[];
  rowHeight: number;
  height: number;
  getKey: (item: T) => string;
  renderRow: (item: T, index: number) => ReactNode;
  overscan?: number;
  className?: string;
  /** Fired when the user is scrolled to the bottom, for reveal-on-scroll logic. */
  onAtBottomChange?: (atBottom: boolean) => void;
  label?: string;
}

/**
 * Fixed-row-height windowed list. Renders only the visible slice plus overscan,
 * keeps rows in a `list`/`listitem` structure with aria-setsize/posinset so
 * screen readers still know the full length, and preserves scroll position when
 * items are appended (the container owns scrollTop).
 */
export function VirtualList<T>({
  items,
  rowHeight,
  height,
  getKey,
  renderRow,
  overscan = 4,
  className,
  onAtBottomChange,
  label,
}: VirtualListProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [scrollTop, setScrollTop] = useState(0);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    const now = el.scrollHeight - el.scrollTop - el.clientHeight < 2;
    if (now !== atBottom.current) {
      atBottom.current = now;
      onAtBottomChange?.(now);
    }
  }, [onAtBottomChange]);

  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollTop > el.scrollHeight) el.scrollTop = 0;
  }, [items.length]);

  const w = computeWindow(items.length, rowHeight, scrollTop, height, overscan);

  return (
    <div ref={ref} onScroll={onScroll} style={{ height, overflowY: "auto" }} className={className} role="list" aria-label={label}>
      <div style={{ height: w.totalHeight, position: "relative" }}>
        <div style={{ transform: `translateY(${w.offsetTop}px)` }}>
          {items.slice(w.start, w.end).map((item, i) => (
            <div
              key={getKey(item)}
              role="listitem"
              aria-setsize={items.length}
              aria-posinset={w.start + i + 1}
              style={{ height: rowHeight }}
            >
              {renderRow(item, w.start + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

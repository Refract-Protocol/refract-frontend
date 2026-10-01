"use client";

import { useEffect, useMemo, useState } from "react";

interface UsePaginationResult<T> {
  visible: T[];
  hasMore: boolean;
  loadMore: () => void;
  total: number;
}

/**
 * Generic client-side windowing of an already-fetched array. Renders the
 * first `pageSize` items and grows the window by `pageSize` each time
 * `loadMore` is called. Ordering is preserved (stable across page loads),
 * so callers keep their existing most-recent-first ordering.
 *
 * `resetKey` (typically the wallet `address`) resets the window back to
 * page 1 whenever it changes, so switching wallets never leaves a stale
 * expanded window behind.
 */
export function usePagination<T>(items: T[], pageSize: number, resetKey?: string | null): UsePaginationResult<T> {
  const [count, setCount] = useState(pageSize);

  useEffect(() => {
    setCount(pageSize);
  }, [resetKey, pageSize]);

  const total = items.length;
  const visible = useMemo(() => items.slice(0, count), [items, count]);
  const hasMore = count < total;

  const loadMore = () => {
    setCount((c) => c + pageSize);
  };

  return { visible, hasMore, loadMore, total };
}

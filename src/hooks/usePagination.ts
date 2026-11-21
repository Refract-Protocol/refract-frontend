import { useCallback, useMemo, useState } from 'react';

export interface UsePaginationOptions {
  totalItems?: number;
  pageSize?: number;
  initialPageIndex?: number;
}

export interface UsePaginationResult {
  pageIndex: number;
  pageSize: number;
  totalItems: number;
  pageCount: number;
  canPreviousPage: boolean;
  canNextPage: boolean;
  setPageIndex: (index: number) => void;
  nextPage: () => void;
  previousPage: () => void;
  setPageSize: (size: number) => void;
}

const DEFAULT_PAGE_SIZE = 10;

export function usePagination({
  totalItems,
  pageSize: initialPageSize = DEFAULT_PAGE_SIZE,
  initialPageIndex = 0,
}: UsePaginationOptions = {}): UsePaginationResult {
  const [pageIndex, setPageIndexState] = useState(initialPageIndex);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const resolvedTotal = totalItems ?? 0;
  const pageCount = Math.max(1, Math.ceil(resolvedTotal / pageSize));

  // Clamp the page index when the underlying list shrinks so we never point
  // past the last valid page. Skip clamping while totalItems is still loading
  // (0 or undefined) to avoid resetting the page on initial render.
  const clampedPageIndex = useMemo(() => {
    if (!resolvedTotal) {
      return pageIndex;
    }
    const lastValidIndex = pageCount - 1;
    return pageIndex > lastValidIndex ? lastValidIndex : pageIndex;
  }, [pageIndex, pageCount, resolvedTotal]);

  const setPageIndex = useCallback(
    (index: number) => {
      setPageIndexState(Math.max(0, index));
    },
    [],
  );

  const nextPage = useCallback(() => {
    setPageIndexState((current) => Math.min(current + 1, pageCount - 1));
  }, [pageCount]);

  const previousPage = useCallback(() => {
    setPageIndexState((current) => Math.max(current - 1, 0));
  }, []);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPageIndexState(0);
  }, []);

  return {
    pageIndex: clampedPageIndex,
    pageSize,
    totalItems: resolvedTotal,
    pageCount,
    canPreviousPage: clampedPageIndex > 0,
    canNextPage: clampedPageIndex < pageCount - 1,
    setPageIndex,
    nextPage,
    previousPage,
    setPageSize,
  };
}

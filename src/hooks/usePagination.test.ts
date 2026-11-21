import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePagination } from './usePagination';

describe('usePagination', () => {
  it('clamps the page index when the item count shrinks', () => {
    const { result, rerender } = renderHook(
      ({ totalItems }: { totalItems: number }) =>
        usePagination({ totalItems, pageSize: 2, initialPageIndex: 2 }),
      { initialProps: { totalItems: 10 } },
    );

    expect(result.current.pageIndex).toBe(2);

    act(() => {
      rerender({ totalItems: 5 });
    });

    expect(result.current.pageIndex).toBe(1);
    expect(result.current.canNextPage).toBe(false);
  });

  it('does not clamp while totalItems is still loading', () => {
    const { result } = renderHook(() =>
      usePagination({ totalItems: 0, pageSize: 2, initialPageIndex: 2 }),
    );

    expect(result.current.pageIndex).toBe(2);
  });
});

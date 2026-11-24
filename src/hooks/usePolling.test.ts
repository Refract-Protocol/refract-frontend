import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePolling } from './usePolling';

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports an error when the polled function throws', async () => {
    const failure = new Error('poll failed');
    const fn = vi.fn().mockRejectedValue(failure);

    const { result } = renderHook(() => usePolling(fn, { intervalMs: 1000 }));

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe(failure);
    expect(result.current.data).toBeUndefined();
  });

  it('clears the error on the next successful poll', async () => {
    const failure = new Error('poll failed');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue('ok');

    const { result } = renderHook(() => usePolling(fn, { intervalMs: 1000 }));

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    await result.current.refresh();

    await waitFor(() => {
      expect(result.current.isError).toBe(false);
    });

    expect(result.current.error).toBeUndefined();
    expect(result.current.data).toBe('ok');
  });
});

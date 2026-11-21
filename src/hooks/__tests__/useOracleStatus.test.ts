import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useOracleStatus } from '../useOracleStatus';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => state === 'hidden',
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useOracleStatus', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not fetch while the document is hidden', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    setVisibility('hidden');

    renderHook(() => useOracleStatus());

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resumes polling when the document becomes visible again', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    setVisibility('hidden');

    renderHook(() => useOracleStatus());

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      setVisibility('visible');
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});

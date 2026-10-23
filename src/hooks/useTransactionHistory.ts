"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import { openHorizonStream } from "@/lib/realtime/horizonStream";
import { fetchHistoryPage, HorizonError, type HistoryEntry } from "@/lib/stellar/horizon";

interface TransactionHistoryState {
  entries: HistoryEntry[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Reads a wallet's Refract contract activity straight from Horizon, one
 * cursor page at a time. A 404 means the account isn't funded yet, which is
 * treated as an empty history rather than an error.
 */
export function useTransactionHistory(address: string | null): TransactionHistoryState {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const streamEnabled = useFeatureFlag("horizon-stream");
  /** Resume point for SSE; set once the initial REST hydration lands. "now" if the account has no records. */
  const [streamCursor, setStreamCursor] = useState<string | null>(null);

  const load = useCallback(
    async (from: string | null, reset: boolean) => {
      if (!address) return;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const page = await fetchHistoryPage(address, from, controller.signal);
        if (controller.signal.aborted) return;
        setEntries((prev) => (reset ? page.entries : [...prev, ...page.entries]));
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
        if (reset) setStreamCursor(page.latestCursor ?? "now");
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof HorizonError && err.status === 404) {
          setEntries([]);
          setHasMore(false);
          if (reset) setStreamCursor("now");
        } else {
          setError(err instanceof Error ? err.message : "Failed to load transaction history");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [address]
  );

  useEffect(() => {
    setEntries([]);
    setCursor(null);
    setHasMore(false);
    setStreamCursor(null);
    if (address) void load(null, true);
    return () => controllerRef.current?.abort();
  }, [address, load]);

  // Live tail: SSE only appends beyond the hydrated cursor; ids dedupe against REST rows.
  useEffect(() => {
    if (!streamEnabled || !address || !streamCursor) return;
    return openHorizonStream(address, streamCursor, (fresh) =>
      setEntries((prev) => {
        const known = new Set(prev.map((e) => e.id));
        const added = fresh.filter((e) => !known.has(e.id)).reverse();
        return added.length > 0 ? [...added, ...prev] : prev;
      })
    );
    // streamCursor is the hydration snapshot; later changes must not reopen the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamEnabled, address, streamCursor === null]);

  const loadMore = useCallback(() => {
    if (cursor && !loading) void load(cursor, false);
  }, [cursor, loading, load]);

  return { entries, loading, error, hasMore, loadMore };
}

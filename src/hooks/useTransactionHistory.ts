"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchHistoryPage,
  streamOperations,
  HorizonError,
  type HistoryEntry,
} from "@/lib/stellar/horizon";

interface TransactionHistoryState {
  entries: HistoryEntry[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  /** True when the SSE stream is connected and receiving live updates. */
  streaming: boolean;
}

export function useTransactionHistory(address: string | null): TransactionHistoryState {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null as string | null);
  const [streaming, setStreaming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const streamRef = useRef<(() => void) | null>(null);

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
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof HorizonError && err.status === 404) {
          setEntries([]);
          setHasMore(false);
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
    if (address) void load(null, true);
    return () => controllerRef.current?.abort();
  }, [address, load]);

  useEffect(() => {
    if (!address) {
      setStreaming(false);
      return;
    }

    streamRef.current?.();
    streamRef.current = null;

    const close = streamOperations(address, {
      onEntry: (entry) => {
        setEntries((prev) => {
          if (prev.some((e) => e.id === entry.id)) return prev;
          return [entry, ...prev];
        });
      },
      onError: () => {
        setStreaming(false);
      },
    });

    streamRef.current = close;
    setStreaming(true);

    return () => {
      close();
      streamRef.current = null;
      setStreaming(false);
    };
  }, [address]);

  const loadMore = useCallback(() => {
    if (cursor && !loading) void load(cursor, false);
  }, [cursor, loading, load]);

  return { entries, loading, error, hasMore, loadMore, streaming };
}

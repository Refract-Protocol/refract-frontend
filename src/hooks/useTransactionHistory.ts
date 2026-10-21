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

/**
 * Reads a wallet's Refract contract activity from Horizon.
 *
 * The initial page is fetched via REST (`fetchHistoryPage`, newest-first,
 * cursor-paged) so the user sees existing history immediately. After that,
 * an SSE stream (`streamOperations`) is opened on the same
 * `/accounts/{address}/operations` endpoint with `cursor=now`, which pushes
 * new operations as they land on-chain. Streamed entries are prepended to
 * the list so the newest activity is always at the top.
 *
 * `loadMore` continues to use the REST cursor for older pages.
 *
 * A 404 means the account isn't funded yet — treated as empty history.
 */
export function useTransactionHistory(address: string | null): TransactionHistoryState {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  // Initial REST load when the address changes.
  useEffect(() => {
    setEntries([]);
    setCursor(null);
    setHasMore(false);
    if (address) void load(null, true);
    return () => controllerRef.current?.abort();
  }, [address, load]);

  // Open the SSE stream for live updates after the initial load.
  useEffect(() => {
    if (!address) {
      setStreaming(false);
      return;
    }

    // Tear down any previous stream before opening a new one.
    streamRef.current?.();
    streamRef.current = null;

    const close = streamOperations(address, {
      onEntry: (entry) => {
        setEntries((prev) => {
          // De-dupe by entry id — Horizon occasionally re-emits on reconnect.
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

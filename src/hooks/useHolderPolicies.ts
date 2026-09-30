"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchHolderPolicies, type Policy } from "@/lib/api/policies";
import { fixtureHolderPolicies } from "@/lib/fixtures/policies";
import { ApiUnreachableError } from "@/lib/api/client";

interface HolderPoliciesState {
  data: Policy[] | null;
  loading: boolean;
  error: string | null;
  isFixture: boolean;
  /** True while an incremental "load more" request is in flight. */
  loadingMore: boolean;
  /** Cursor for the next page, or null when there is nothing more to fetch. */
  nextCursor: string | null;
  /** Whether more pages are available from the backend. */
  hasMore: boolean;
  /** Fetches the next page and appends it to `data`. No-op when `hasMore` is false. */
  loadMore: () => void;
}

/**
 * Loads a wallet's policies from GET /api/v1/policies/holder/:address — a
 * real backend route. Its in-memory store is empty on every process
 * restart though, so this also falls back to a labeled fixture both when
 * the API is unreachable AND when it legitimately returns zero policies,
 * so the dashboard has something to demo. `isFixture` tells the caller
 * which happened.
 *
 * Pagination: the endpoint accepts optional `cursor`/`limit` query params
 * and may return `{ items, nextCursor, hasMore }` metadata. When the
 * backend omits that metadata (legacy response), the hook degrades
 * gracefully to today's fetch-everything-in-one-call behavior: `hasMore`
 * is false and `loadMore` is a no-op. `loadMore` appends the next page to
 * the accumulated `data` using the returned cursor.
 *
 * Race-condition guard: the effect is keyed on `address`, so switching
 * wallets aborts the previous in-flight request via `AbortController`.
 * The success path additionally checks `controller.signal.aborted` before
 * committing state, so a stale response that resolves after a fresher one
 * (out-of-order resolution) can never clobber the newer wallet's data.
 */
export function useHolderPolicies(address: string | null): HolderPoliciesState {
  const [state, setState] = useState<HolderPoliciesState>({
    data: null,
    loading: false,
    error: null,
    isFixture: false,
    loadingMore: false,
    nextCursor: null,
    hasMore: false,
    loadMore: () => {},
  });
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    if (!address) {
      cursorRef.current = null;
      hasMoreRef.current = false;
      loadingMoreRef.current = false;
      setState({
        data: null,
        loading: false,
        error: null,
        isFixture: false,
        loadingMore: false,
        nextCursor: null,
        hasMore: false,
        loadMore: () => {},
      });
      return;
    }
    const controller = new AbortController();
    cursorRef.current = null;
    hasMoreRef.current = false;
    loadingMoreRef.current = false;
    setState((s) => ({ ...s, loading: true, loadingMore: false, nextCursor: null, hasMore: false }));

    fetchHolderPolicies(address, controller.signal)
      .then(({ policies, nextCursor, hasMore }) => {
        if (controller.signal.aborted) return;
        cursorRef.current = nextCursor ?? null;
        hasMoreRef.current = hasMore ?? false;
        if (policies.length > 0) {
          setState({
            data: policies,
            loading: false,
            error: null,
            isFixture: false,
            loadingMore: false,
            nextCursor: nextCursor ?? null,
            hasMore: hasMore ?? false,
            loadMore: state.loadMore,
          });
        } else {
          setState({
            data: fixtureHolderPolicies(address),
            loading: false,
            error: null,
            isFixture: true,
            loadingMore: false,
            nextCursor: null,
            hasMore: false,
            loadMore: state.loadMore,
          });
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiUnreachableError) {
          setState({
            data: fixtureHolderPolicies(address),
            loading: false,
            error: null,
            isFixture: true,
            loadingMore: false,
            nextCursor: null,
            hasMore: false,
            loadMore: state.loadMore,
          });
          return;
        }
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load policies",
          isFixture: false,
          loadingMore: false,
          nextCursor: null,
          hasMore: false,
          loadMore: state.loadMore,
        });
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const loadMore = useCallback(() => {
    if (!address) return;
    if (!hasMoreRef.current) return;
    if (loadingMoreRef.current) return;
    const cursor = cursorRef.current;
    if (!cursor) return;

    loadingMoreRef.current = true;
    setState((s) => ({ ...s, loadingMore: true }));

    fetchHolderPolicies(address, undefined, { cursor })
      .then(({ policies, nextCursor, hasMore }) => {
        cursorRef.current = nextCursor ?? null;
        hasMoreRef.current = hasMore ?? false;
        loadingMoreRef.current = false;
        setState((s) => ({
          ...s,
          data: s.data ? [...s.data, ...policies] : policies,
          loadingMore: false,
          nextCursor: nextCursor ?? null,
          hasMore: hasMore ?? false,
        }));
      })
      .catch((err) => {
        loadingMoreRef.current = false;
        setState((s) => ({
          ...s,
          loadingMore: false,
          error: err instanceof Error ? err.message : "Failed to load more policies",
        }));
      });
  }, [address]);

  return { ...state, loadMore };
}

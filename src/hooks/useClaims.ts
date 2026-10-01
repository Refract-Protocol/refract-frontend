"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Policy } from "@/lib/api/policies";
import { fetchHolderClaims, type ClaimRecord } from "@/lib/api/claims";
import { fixtureClaimsForHolder } from "@/lib/fixtures/claims";

/**
 * Loads a wallet's claim history from GET /api/v1/claims/holder/:address.
 * Mirrors useHolderPolicies: the backend's in-memory history is empty on
 * every process restart, so this falls back to the labeled fixture both
 * when the API is unreachable AND when it legitimately returns zero claims,
 * so the dashboard has something to demo.
 *
 * Supports cursor-based incremental fetching: when the backend returns
 * pagination metadata (`nextCursor`/`hasMore`), `loadMore` fetches the next
 * page and appends it. When the backend omits that metadata (legacy
 * response), the hook degrades gracefully to today's fetch-everything-in-
 * one-call behavior and `hasMore` stays false.
 */
export function useClaims(address: string | null, policies: Policy[] | null): ClaimRecord[] {
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(false);

  useEffect(() => {
    if (!address || !policies) {
      setClaims([]);
      setNextCursor(null);
      setHasMore(false);
      cursorRef.current = null;
      hasMoreRef.current = false;
      return;
    }
    const controller = new AbortController();

    fetchHolderClaims(address, controller.signal)
      .then(({ claims: fetched, nextCursor: cursor, hasMore: more }) => {
        // Guard against a stale, superseded request resolving after a fresher
        // one (e.g. rapid wallet switching): ignore its response entirely.
        if (controller.signal.aborted) return;
        setClaims(fetched.length > 0 ? fetched : fixtureClaimsForHolder(address, policies));
        cursorRef.current = cursor ?? null;
        hasMoreRef.current = more ?? false;
        setNextCursor(cursor ?? null);
        setHasMore(more ?? false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setClaims(fixtureClaimsForHolder(address, policies));
        cursorRef.current = null;
        hasMoreRef.current = false;
        setNextCursor(null);
        setHasMore(false);
      });

    return () => controller.abort();
  }, [address, policies]);

  const loadMore = useCallback(async () => {
    if (!address || !policies || !hasMoreRef.current || loadingMore) return;
    setLoadingMore(true);
    try {
      const { claims: fetched, nextCursor: cursor, hasMore: more } = await fetchHolderClaims(
        address,
        undefined,
        { cursor: cursorRef.current ?? undefined },
      );
      setClaims((prev) => [...prev, ...fetched]);
      cursorRef.current = cursor ?? null;
      hasMoreRef.current = more ?? false;
      setNextCursor(cursor ?? null);
      setHasMore(more ?? false);
    } catch {
      // Keep the already-loaded claims; leave pagination state untouched so a
      // later retry can resume from the same cursor.
    } finally {
      setLoadingMore(false);
    }
  }, [address, policies, loadingMore]);

  // Expose pagination controls alongside the claims array without breaking
  // existing consumers that only read the returned array.
  (claims as ClaimRecord[] & {
    loadMore?: () => Promise<void>;
    hasMore?: boolean;
    nextCursor?: string | null;
    loadingMore?: boolean;
  }).loadMore = loadMore;
  (claims as ClaimRecord[] & { hasMore?: boolean }).hasMore = hasMore;
  (claims as ClaimRecord[] & { nextCursor?: string | null }).nextCursor = nextCursor;
  (claims as ClaimRecord[] & { loadingMore?: boolean }).loadingMore = loadingMore;

  return claims;
}

"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { fetchHolderClaims, type ClaimRecord } from "@/lib/api/claims";
import type { Policy } from "@/lib/api/policies";
import { fixtureClaimsForHolder } from "@/lib/fixtures/claims";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import {
  mergeClaims,
  normalizeClaimFrame,
  normalizeRestClaim,
  type StreamClaim,
} from "@/lib/realtime/claims";
import { realtimeClient, type RealtimeState } from "@/lib/realtime/client";

export type ClaimsResult = ClaimRecord[] & {
  data: ClaimRecord[];
  loading: boolean;
  error: string | null;
  isFixture: boolean;
  isStale: boolean;
};

export function useClaims(address?: string | null, policies?: Policy[] | null): ClaimsResult {
  const wallet = useWallet();
  const holder =
    address === undefined ? (wallet.status === "connected" ? wallet.address : null) : address;
  const enabled = useFeatureFlag("realtime-claims-settlement");
  const [restRows, setRestRows] = useState<StreamClaim[]>([]);
  const [pushedRows, setPushedRows] = useState<StreamClaim[]>([]);
  const [loading, setLoading] = useState(Boolean(holder));
  const [error, setError] = useState<string | null>(null);
  const [isFixture, setIsFixture] = useState(false);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setRestRows([]);
    setPushedRows([]);
    if (!holder) {
      setLoading(false);
      setError(null);
      setIsFixture(false);
      return () => controller.abort();
    }
    setLoading(true);
    setError(null);
    const load = async () => {
      let cursor: string | undefined;
      const seenCursors = new Set<string>();
      const rows: ClaimRecord[] = [];
      try {
        do {
          if (cursor && seenCursors.has(cursor))
            throw new Error("Claims pagination cursor repeated");
          if (cursor) seenCursors.add(cursor);
          const page = await fetchHolderClaims(holder, { cursor, limit: 50 }, controller.signal);
          rows.push(...page.items.map(normalizeRestClaim));
          cursor = page.hasMore ? page.nextCursor : undefined;
          if (page.hasMore && !cursor)
            throw new Error("Claims pagination response omitted nextCursor");
        } while (cursor);
        if (active) {
          setRestRows(rows);
          setIsFixture(false);
          setLoading(false);
        }
      } catch (cause) {
        if (!active) return;
        setRestRows(fixtureClaimsForHolder(holder, policies ?? []).map(normalizeRestClaim));
        setIsFixture(true);
        setError(cause instanceof Error ? cause.message : "Unable to load claims");
        setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [holder, policies]);

  useEffect(() => {
    realtimeClient.setIdentity(holder);
    if (!enabled || !holder) {
      setIsStale(false);
      return;
    }
    return realtimeClient.subscribe(
      "claims.settlement",
      (payload) => {
        const claim = normalizeClaimFrame(payload);
        if (!claim || (claim.holder && claim.holder !== holder)) return;
        setPushedRows((current) => mergeClaims(current, [claim]));
      },
      { authenticated: true, onState: (state: RealtimeState) => setIsStale(state !== "live") }
    );
  }, [enabled, holder]);

  const rows = mergeClaims(restRows, pushedRows) as ClaimRecord[];
  const result = rows as ClaimsResult;
  Object.assign(result, { data: rows, loading, error, isFixture, isStale });
  return result;
}

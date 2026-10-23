"use client";
import { useCallback, useEffect, useState } from "react";
import { fetchRecentClaims, type ClaimRecord } from "@/lib/api/claims";
import { FIXTURE_RECENT_CLAIMS } from "@/lib/fixtures/recentClaims";
import { useRealtimeTopic } from "./useRealtimeTopic";

export function useRecentClaims() {
  const load = useCallback(async (signal: AbortSignal) => {
    try { const result = await fetchRecentClaims({ limit: 10 }, signal); setFixture(false); return result.items; }
    catch { setFixture(true); return FIXTURE_RECENT_CLAIMS; }
  }, []);
  const { data, isStale, isLoading } = useRealtimeTopic<ClaimRecord[]>("claim_settlement", load);
  const [isFixture, setFixture] = useState(false);
  useEffect(() => { if (data && data !== FIXTURE_RECENT_CLAIMS) setFixture(false); }, [data]);
  return { data: data ?? FIXTURE_RECENT_CLAIMS, loading: isLoading, isFixture, isStale };
}

"use client";

import { useEffect, useState } from "react";
import { fetchClaims, fixtureClaimsForHolder, type ClaimRecord } from "@/lib/api/claims";
import type { Policy } from "@/lib/api/policies";

export interface UseClaimsResult {
  data: ClaimRecord[];
  loading: boolean;
  error: string | null;
  source: "live" | "fixture";
}

/**
 * Loads the claim history for a holder.
 *
 * The live request only depends on the address, so it starts immediately
 * rather than waiting on the policy list. The fixture fallback needs the
 * policies, so it is derived separately once they arrive.
 */
export function useClaims(address: string | null, policies: Policy[] | null): UseClaimsResult {
  const [data, setData] = useState<ClaimRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(address));
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"live" | "fixture">("live");

  useEffect(() => {
    if (!address) {
      setData([]);
      setLoading(false);
      setError(null);
      setSource("live");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchClaims(address)
      .then((claims) => {
        if (cancelled) return;
        setData(claims);
        setSource("live");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load claims");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  // Fixture fallback: only derived once policies have resolved and the live
  // request came back empty/unavailable.
  useEffect(() => {
    if (!address || !policies || loading || error) return;
    if (data.length > 0) return;
    const fixture = fixtureClaimsForHolder(address, policies);
    if (fixture.length > 0) {
      setData(fixture);
      setSource("fixture");
    }
  }, [address, policies, loading, error, data.length]);

  return { data, loading, error, source };
}

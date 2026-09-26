"use client";

import { useEffect, useState } from "react";
import type { Policy } from "@/lib/api/policies";
import { fetchHolderClaims, type ClaimRecord } from "@/lib/api/claims";
import { fixtureClaimsForHolder } from "@/lib/fixtures/claims";

/**
 * Where a hook's data came from. Distinguishes a genuinely empty portfolio
 * (`live-empty`) from an unreachable API (`fixture-unreachable`) so callers
 * can render the real empty state instead of fabricated fixtures.
 */
export type ClaimSource = "live" | "live-empty" | "fixture-unreachable" | "fixture-demo";

export interface UseClaimsResult {
  claims: ClaimRecord[];
  source: ClaimSource;
}

/**
 * Loads a wallet's claim history from GET /api/v1/claims/holder/:address.
 *
 * The backend's in-memory history is empty on every process restart, so the
 * two outcomes are modelled separately:
 * - a successful response with zero claims resolves to `live-empty` with an
 *   empty array, letting the dashboard show its real empty state;
 * - an unreachable API resolves to `fixture-unreachable` and falls back to the
 *   labeled fixture so the dashboard still has something to demo.
 *
 * `useClaims` is chained on `policies`, so an empty policy list resolves
 * claims to empty rather than leaving them pending forever.
 */
export function useClaims(
  address: string | null,
  policies: Policy[] | null,
): UseClaimsResult {
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [source, setSource] = useState<ClaimSource>("live-empty");

  useEffect(() => {
    if (!address || !policies) {
      setClaims([]);
      setSource("live-empty");
      return;
    }
    if (policies.length === 0) {
      setClaims([]);
      setSource("live-empty");
      return;
    }
    const controller = new AbortController();

    fetchHolderClaims(address, controller.signal)
      .then(({ claims: fetched }) => {
        if (fetched.length > 0) {
          setClaims(fetched);
          setSource("live");
        } else {
          setClaims([]);
          setSource("live-empty");
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setClaims(fixtureClaimsForHolder(address, policies));
        setSource("fixture-unreachable");
      });

    return () => controller.abort();
  }, [address, policies]);

  return { claims, source };
}

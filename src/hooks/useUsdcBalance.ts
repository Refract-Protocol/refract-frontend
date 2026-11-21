"use client";

import { useEffect, useState } from "react";
import { fetchUsdcBalance, type UsdcBalance as UsdcBalanceResponse } from "@/lib/api/pool";

/**
 * Fetch the connected wallet's USDC balance.
 *
 * Mirrors `useUserPoolPosition`: no-op until an address is provided, and an
 * `AbortController` cancels any in-flight request when the address changes or
 * the component unmounts. Following `useLockupStatus`'s precedent, this hook
 * never fabricates a value — an address-specific on-chain read either resolves
 * to real data or reports an error.
 */
export function useUsdcBalance(address: string | null) {
  const [data, setData] = useState<UsdcBalanceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);

    fetchUsdcBalance(address, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(err instanceof Error ? err.message : "Balance unavailable");
        setLoading(false);
      });

    return () => controller.abort();
  }, [address]);

  return { data, loading, error };
}

/**
 * Normalise a USDC balance response into a numeric amount for pre-flight
 * affordability checks (e.g. `batchCheckout`). Returns `null` when the
 * balance is unavailable so callers can skip the check rather than treat a
 * missing read as a zero balance.
 */
export function getUsdcBalanceAmount(
  balance: UsdcBalanceResponse | null,
): number | null {
  if (!balance) return null;
  const raw = (balance as { balance?: unknown }).balance;
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

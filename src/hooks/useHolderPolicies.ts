"use client";

import { useEffect, useState } from "react";
import { fetchHolderPolicies, type Policy } from "@/lib/api/policies";
import { fixtureHolderPolicies } from "@/lib/fixtures/policies";
import { useWallet } from "@/lib/wallet/WalletProvider";

export function useHolderPolicies(address?: string | null) {
  const wallet = useWallet();
  const holder =
    address === undefined ? (wallet.status === "connected" ? wallet.address : null) : address;
  const [data, setData] = useState<Policy[] | null>(null);
  const [loading, setLoading] = useState(Boolean(holder));
  const [error, setError] = useState<string | null>(null);
  const [isFixture, setIsFixture] = useState(false);
  const [isStale] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setData(null);
    if (!holder) {
      setLoading(false);
      setError(null);
      setIsFixture(false);
      return () => controller.abort();
    }
    setLoading(true);
    fetchHolderPolicies(holder, undefined, controller.signal)
      .then((response) => {
        if (!active) return;
        setData(response.items);
        setIsFixture(false);
        setError(null);
        setLoading(false);
      })
      .catch((cause) => {
        if (!active) return;
        setData(fixtureHolderPolicies(holder));
        setIsFixture(true);
        setError(cause instanceof Error ? cause.message : "Unable to load policies");
        setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [holder]);

  return { data, loading, error, isFixture, isStale };
}

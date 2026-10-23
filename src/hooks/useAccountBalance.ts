"use client";
import { useCallback, useEffect, useState } from "react";
import { ACTIVE_NETWORK } from "@/lib/network";
import { useRealtimeTopic } from "./useRealtimeTopic";

export interface AccountBalance { asset: string; balance: string; assetType: string; decimals: number }
export interface AccountState { balances: AccountBalance[]; sequence: string; updatedAt: number }
const OPTIMISTIC_EVENT = "refract:account-balance-delta";
export function publishAccountBalanceDelta(address: string, asset: string, delta: number) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPTIMISTIC_EVENT, { detail: { address, asset, delta } }));
}

async function fetchAccount(address: string, signal: AbortSignal): Promise<AccountState> {
  const response = await fetch(`${ACTIVE_NETWORK.horizonUrl}/accounts/${address}`, { signal });
  if (response.status === 404) return { balances: [], sequence: "0", updatedAt: Date.now() };
  if (!response.ok) throw new Error(`Horizon account request failed (${response.status})`);
  const account = await response.json();
  return { balances: (account.balances ?? []).map((item: { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }) => ({
    asset: item.asset_type === "native" ? "XLM" : `${item.asset_code ?? "UNKNOWN"}:${item.asset_issuer ?? ""}`,
    balance: item.balance, assetType: item.asset_type, decimals: 7,
  })), sequence: String(account.sequence), updatedAt: Date.now() };
}

export function useAccountBalance(address: string | null) {
  const topic = address ? `account:${ACTIVE_NETWORK.id}:${address}` : "account:disconnected";
  const fetcher = useCallback((signal: AbortSignal) => address
    ? fetchAccount(address, signal)
    : Promise.resolve({ balances: [], sequence: "0", updatedAt: Date.now() }), [address]);
  const { data, isStale, isLoading, refresh } = useRealtimeTopic<AccountState>(
    topic, fetcher, address ?? undefined, Boolean(address),
  );
  const [optimistic, setOptimistic] = useState<{ address: string; balances: AccountBalance[] } | null>(null);
  useEffect(() => setOptimistic(null), [address]);
  useEffect(() => {
    if (!address) return;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ address: string; asset: string; delta: number }>).detail;
      if (detail.address !== address) return;
      setOptimistic((previous) => {
        const balances = previous?.address === address ? previous.balances : data?.balances ?? [];
        return { address, balances: balances.map((entry) =>
          entry.asset === detail.asset || entry.asset.startsWith(`${detail.asset}:`)
            ? { ...entry, balance: String(Math.max(0, Number(entry.balance) + detail.delta)) } : entry) };
      });
      setTimeout(() => { void refresh().catch(() => undefined); }, 2_500);
    };
    window.addEventListener(OPTIMISTIC_EVENT, listener);
    return () => window.removeEventListener(OPTIMISTIC_EVENT, listener);
  }, [address, data, refresh]);
  const deduct = useCallback((asset: string, amount: number) => {
    if (!address) return;
    setOptimistic({ address, balances: (data?.balances ?? []).map((entry) => entry.asset === asset
      ? { ...entry, balance: String(Math.max(0, Number(entry.balance) - amount)) } : entry) });
  }, [data]);
  useEffect(() => { if (data && !isStale) setOptimistic(null); }, [data, isStale]);
  const visibleOptimistic = optimistic?.address === address ? optimistic.balances : null;
  return { balances: visibleOptimistic ?? data?.balances ?? [], sequence: data?.sequence ?? "0", updatedAt: data?.updatedAt ?? null, isStale, isLoading, deduct };
}

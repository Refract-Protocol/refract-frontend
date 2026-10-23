"use client";
import { useCallback, useMemo } from "react";
import { fetchHolderClaims, fetchRecentClaims, type ClaimRecord } from "@/lib/api/claims";
import type { Policy } from "@/lib/api/policies";
import { ACTIVE_NETWORK } from "@/lib/network";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useRealtimeTopic } from "./useRealtimeTopic";

export type ClaimsResult = ClaimRecord[] & { data: ClaimRecord[] | null; loading: boolean; isStale: boolean };

export function useClaims(addressArg?: string | null, _policies?: Policy[] | null): ClaimsResult {
  const wallet = useWallet();
  const address = addressArg === undefined
    ? (wallet.status === "connected" ? wallet.address : null)
    : addressArg;
  const load = useCallback(async (signal: AbortSignal) => address
    ? (await fetchHolderClaims(address, {}, signal)).items
    : (await fetchRecentClaims({ limit: 50 }, signal)).items, [address]);
  const topic = address ? `claims:${ACTIVE_NETWORK.id}:${address}` : "claim_settlement";
  const { data, isLoading, isStale } = useRealtimeTopic<ClaimRecord[]>(topic, load, address ?? undefined);
  return useMemo(() => Object.assign([...(data ?? [])], {
    data: data ?? (address ? null : []), loading: isLoading, isStale,
  }) as ClaimsResult, [data, address, isLoading, isStale]);
}

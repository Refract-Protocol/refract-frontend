"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import { realtimeClient, type RealtimeClient } from "./client";
import { deriveScope, isScopedQueryKey } from "./scope";

/**
 * Owns realtime's identity the way src/lib/network.ts owns REST base URLs:
 * keeps the client's scope (network + account) in sync with the wallet, and
 * when that scope changes resets every realtime-merged / wallet-scoped query
 * so nothing from the previous identity survives the switch.
 *
 * Also turns the connection on/off from the `realtime` feature flag
 * (`realtime-oracle` is honoured as a legacy alias).
 */
export function RealtimeScopeSync({ client = realtimeClient }: { client?: RealtimeClient }) {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const realtimeFlag = useFeatureFlag("realtime");
  const legacyFlag = useFeatureFlag("realtime-oracle");
  const enabled = realtimeFlag || legacyFlag;

  const { network, account } = deriveScope(wallet);

  useEffect(() => {
    client.setEnabled(enabled);
  }, [client, enabled]);

  useEffect(() => {
    client.setScope({ network, account });
  }, [client, network, account]);

  useEffect(
    () =>
      client.onScopeChange(() => {
        void queryClient.resetQueries({ predicate: (query) => isScopedQueryKey(query.queryKey) });
      }),
    [client, queryClient]
  );

  return null;
}

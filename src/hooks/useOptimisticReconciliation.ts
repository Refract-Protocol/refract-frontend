"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { realtimeClient } from "@/lib/realtime/client";
import {
  parseOptimisticEvent,
  registerOptimisticAction,
  resolveOptimisticAction,
  type OptimisticActionKind,
} from "@/lib/realtime/optimisticReconciliation";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import { apiRequest } from "@/lib/api/client";

export function useOptimisticReconciliation() {
  const wallet = useWallet();
  const enabled = useFeatureFlag("realtime-transactions");
  const [notices, setNotices] = useState<Array<{ id: string; message: string }>>([]);

  useEffect(() => {
    const identity = wallet.status === "connected" ? wallet.address : null;
    realtimeClient.setIdentity(identity);
    if (!enabled || !identity) return;
    return realtimeClient.subscribe(
      "transactions.confirmation",
      (payload) => {
        const event = parseOptimisticEvent(payload);
        if (!event) return;
        resolveOptimisticAction(event);
      },
      { authenticated: true }
    );
  }, [enabled, wallet.status, wallet.address]);

  const register = useCallback(
    (input: {
      correlationId: string;
      kind: OptimisticActionKind;
      onConfirm: (authoritative?: Record<string, unknown>) => void;
      onRollback: (reason: string) => void;
    }) =>
      registerOptimisticAction({
        ...input,
        onRollback: (reason) => {
          setNotices((current) => [
            { id: input.correlationId, message: `${reason} The displayed update was reverted.` },
            ...current,
          ]);
          input.onRollback(reason);
        },
        onUnverified: () =>
          setNotices((current) => [
            {
              id: input.correlationId,
              message:
                "This transaction is still awaiting confirmation. The account view will continue to use REST data.",
            },
            ...current,
          ]),
        verify: async () => {
          const result = await apiRequest<{ status: "confirmed" | "rejected" | "pending" }>(
            "/transactions/verify",
            {
              method: "POST",
              body: { correlationId: input.correlationId },
            }
          );
          return result.status;
        },
      }),
    []
  );

  const dismiss = useCallback(
    (id: string) => setNotices((current) => current.filter((item) => item.id !== id)),
    []
  );
  return { register, notices, dismiss };
}

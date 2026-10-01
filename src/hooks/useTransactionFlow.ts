"use client";

import { useCallback, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { signAndSubmit } from "@/lib/wallet/signAndSubmit";
import { ApiUnreachableError } from "@/lib/api/client";

export type TransactionFlowState<TResult> =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "signing" }
  | { status: "pending-confirmation"; result?: TResult }
  | { status: "success"; result: TResult; demo: boolean; txHash?: string }
  | { status: "error"; message: string };

export interface UseTransactionFlowOptions<TResult> {
  onSuccess?: (result: TResult, txHash?: string, demo?: boolean) => void;
  onError?: (error: Error) => void;
}

/**
 * Shared transaction lifecycle hook managing submit -> sign -> confirm / demo fallback.
 */
export function useTransactionFlow<TResult>(options: UseTransactionFlowOptions<TResult> = {}) {
  const wallet = useWallet();
  const [state, setState] = useState<TransactionFlowState<TResult>>({ status: "idle" });

  const reset = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  const execute = useCallback(
    async (
      buildTx: () => Promise<{ result: TResult; txXdr: string }>,
      buildDemo: () => TResult
    ) => {
      if (wallet.status !== "connected" || !wallet.address) {
        await wallet.connect();
        return;
      }

      setState({ status: "submitting" });

      try {
        const { result, txXdr } = await buildTx();

        setState({ status: "signing" });
        if (!wallet.networkPassphrase) {
          throw new Error("Wallet network is not available — please reconnect and try again");
        }

        const txHash = await signAndSubmit(
          txXdr,
          wallet.address,
          wallet.networkPassphrase,
          () => {
            setState({ status: "pending-confirmation", result });
          }
        );

        setState({ status: "success", result, demo: false, txHash });
        options.onSuccess?.(result, txHash, false);
      } catch (err: unknown) {
        if (err instanceof ApiUnreachableError) {
          const demoResult = buildDemo();
          setState({ status: "success", result: demoResult, demo: true });
          options.onSuccess?.(demoResult, undefined, true);
          return;
        }

        const message = err instanceof Error ? err.message : "An unexpected error occurred";
        setState({ status: "error", message });
        if (err instanceof Error) {
          options.onError?.(err);
        }
      }
    },
    [wallet, options]
  );

  return {
    state,
    setState,
    execute,
    reset,
    isLoading: state.status === "submitting" || state.status === "signing",
    isSigning: state.status === "signing",
    isPending: state.status === "pending-confirmation",
    isSuccess: state.status === "success",
    isError: state.status === "error",
  };
}

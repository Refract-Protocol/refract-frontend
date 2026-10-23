"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiUnreachableError } from "@/lib/api/client";
import { fetchLockupStatus } from "@/lib/api/pool";
import { readLockupStatus } from "@/lib/stellar/rpc";
import type { DataSource } from "@/lib/api/dataSource";
import { usePolling } from "./usePolling";

export const LOCKUP_POLL_INTERVAL_MS = 5 * 60_000;

interface LockupState {
  lockupExpiresAt: number | null;
  loading: boolean;
  dataSource: DataSource | null;
}

export function useLockupStatus(address: string | null): LockupState {
  const [state, setState] = useState<LockupState>({
    lockupExpiresAt: null,
    loading: Boolean(address),
    dataSource: null,
  });
  useEffect(() => {
    setState({ lockupExpiresAt: null, loading: Boolean(address), dataSource: null });
  }, [address]);
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!address) return;
      try {
        const result = await fetchLockupStatus(address, signal);
        if (!signal.aborted)
          setState({
            lockupExpiresAt: result.lockupExpiresAt ? Number(result.lockupExpiresAt) : null,
            loading: false,
            dataSource: "api",
          });
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ApiUnreachableError) {
          try {
            const result = await readLockupStatus(address, signal);
            if (!signal.aborted)
              setState({
                lockupExpiresAt: result.lockupExpiresAt ? Number(result.lockupExpiresAt) : null,
                loading: false,
                dataSource: "chain",
              });
            return;
          } catch {
            // No wallet-specific fixture exists; an unavailable read remains unknown.
          }
        }
        if (!signal.aborted) setState({ lockupExpiresAt: null, loading: false, dataSource: null });
      }
    },
    [address]
  );
  usePolling(load, LOCKUP_POLL_INTERVAL_MS, Boolean(address));

  if (!address && (state.loading || state.lockupExpiresAt !== null || state.dataSource !== null)) {
    return { lockupExpiresAt: null, loading: false, dataSource: null };
  }
  return state;
}

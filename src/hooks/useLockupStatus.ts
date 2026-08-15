"use client";

import { useEffect, useState } from "react";
import { fetchLockupStatus } from "@/lib/api/pool";

interface LockupState {
  /** Unix seconds the address's withdrawal lockup ends, or null if unlocked/never deposited. */
  lockupExpiresAt: number | null;
  loading: boolean;
}

/**
 * Real on-chain read (unlike the other pool hooks, which fall back to
 * fixtures when the backend is unreachable) — there's no meaningful
 * fixture for "is this specific wallet currently locked", so this just
 * stays unlocked (null) if the read fails rather than fabricating a status.
 */
export function useLockupStatus(address: string | null): LockupState {
  const [state, setState] = useState<LockupState>({ lockupExpiresAt: null, loading: false });

  useEffect(() => {
    if (!address) {
      setState({ lockupExpiresAt: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    fetchLockupStatus(address, controller.signal)
      .then(({ lockupExpiresAt }) => {
        setState({ lockupExpiresAt: lockupExpiresAt ? Number(lockupExpiresAt) : null, loading: false });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState({ lockupExpiresAt: null, loading: false });
      });
    return () => controller.abort();
  }, [address]);

  return state;
}

"use client";

import { useEffect, useState } from "react";
import { fetchLockupStatus } from "@/lib/api/pool";

export function useLockupStatus(address: string | null) {
  const [state, setState] = useState<{ lockupExpiresAt: number | null; loading: boolean }>({
    lockupExpiresAt: null,
    loading: false,
  });
  useEffect(() => {
    if (!address) {
      setState({ lockupExpiresAt: null, loading: false });
      return;
    }
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true }));
    fetchLockupStatus(address, controller.signal)
      .then(({ lockupExpiresAt }) => {
        if (!controller.signal.aborted)
          setState({
            lockupExpiresAt: lockupExpiresAt ? Number(lockupExpiresAt) : null,
            loading: false,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ lockupExpiresAt: null, loading: false });
      });
    return () => controller.abort();
  }, [address]);
  return state;
}

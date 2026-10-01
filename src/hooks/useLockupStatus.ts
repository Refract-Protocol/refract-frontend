"use client";

import { useEffect, useState } from "react";
import { fetchLockupStatus } from "@/lib/api/pool";
import { ApiUnreachableError } from "@/lib/api/client";
import { readLockupStatus } from "@/lib/stellar/rpc";
import type { DataSource } from "@/lib/api/dataSource";

interface LockupState {
  /** Unix seconds the address's withdrawal lockup ends, or null if unlocked/never deposited. */
  lockupExpiresAt: number | null;
  loading: boolean;
  /** Which tier answered; null while loading or if every tier failed. */
  dataSource: DataSource | null;
}

/**
 * Backend API first, then a direct Soroban RPC read when the backend is
 * unreachable. There's no meaningful fixture for "is this specific wallet
 * currently locked", so if both fail this stays unlocked (null) rather than
 * fabricating a status.
 */
export function useLockupStatus(address: string | null): LockupState {
  const [state, setState] = useState<LockupState>({ lockupExpiresAt: null, loading: false, dataSource: null });

  useEffect(() => {
    if (!address) {
      setState({ lockupExpiresAt: null, loading: false, dataSource: null });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    const apply = (lockupExpiresAt: string | null, dataSource: DataSource) => {
      // Guard against a stale, superseded request resolving after a
      // fresher one (e.g. rapid wallet switching): if this effect's
      // controller was aborted, its response must not clobber state.
      if (controller.signal.aborted) return;
      setState({ lockupExpiresAt: lockupExpiresAt ? Number(lockupExpiresAt) : null, loading: false, dataSource });
    };
    const fail = () => {
      if (!controller.signal.aborted) setState({ lockupExpiresAt: null, loading: false, dataSource: null });
    };
    fetchLockupStatus(address, controller.signal)
      .then(({ lockupExpiresAt }) => apply(lockupExpiresAt, "api"))
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (!(err instanceof ApiUnreachableError)) return fail();
        readLockupStatus(address, controller.signal)
          .then(({ lockupExpiresAt }) => apply(lockupExpiresAt, "chain"))
          .catch(fail);
      });
    return () => controller.abort();
  }, [address]);

  return state;
}

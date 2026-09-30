"use client";

import { useQuery } from "@tanstack/react-query";
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
  const { data, isLoading } = useQuery({
    queryKey: ["lockupStatus", address],
    enabled: Boolean(address),
    queryFn: async ({ signal }) => {
      try {
        const { lockupExpiresAt } = await fetchLockupStatus(address!, signal);
        return lockupExpiresAt ? Number(lockupExpiresAt) : null;
      } catch (err) {
        if (signal.aborted) throw err;
        return null;
      }
    },
  });

  if (!address) return { lockupExpiresAt: null, loading: false };
  return { lockupExpiresAt: data ?? null, loading: isLoading };
}

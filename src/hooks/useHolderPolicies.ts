import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRealtimeRevalidation } from "./useRealtimeRevalidation";
import type { PolicyRealtimeEvent } from "../lib/domain/realtime";

export interface HolderPolicy {
  id: string;
  coverageType: string;
  coverageAmount: string;
  active: boolean;
  [key: string]: unknown;
}

const HOLDER_POLICIES_QUERY_KEY = ["holderPolicies"] as const;

async function fetchHolderPolicies(holder: string): Promise<HolderPolicy[]> {
  const res = await fetch(`/api/holders/${encodeURIComponent(holder)}/policies`);
  if (!res.ok) {
    throw new Error(`Failed to load policies (${res.status})`);
  }
  return (await res.json()) as HolderPolicy[];
}

export function useHolderPolicies(holder: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => [...HOLDER_POLICIES_QUERY_KEY, holder] as const,
    [holder],
  );

  const query = useQuery({
    queryKey,
    queryFn: () => fetchHolderPolicies(holder as string),
    enabled: Boolean(holder),
  });

  // Optimistic update: patch a single policy in the cached list without a refetch.
  const updatePolicyLocally = useCallback(
    (policyId: string, changes: Partial<HolderPolicy>) => {
      queryClient.setQueryData<HolderPolicy[]>(queryKey, (prev) => {
        if (!prev) return prev;
        return prev.map((policy) =>
          policy.id === policyId ? { ...policy, ...changes } : policy,
        );
      });
    },
    [queryClient, queryKey],
  );

  // Realtime events carry a policy id; patch the cached list in place instead
  // of invalidating the whole query (which would refetch every policy).
  const handleRealtimeEvent = useCallback(
    (event: PolicyRealtimeEvent) => {
      if (!event?.policyId) return;
      updatePolicyLocally(event.policyId, event.changes ?? {});
    },
    [updatePolicyLocally],
  );

  useRealtimeRevalidation({
    queryKey,
    onEvent: handleRealtimeEvent,
  });

  return {
    ...query,
    updatePolicyLocally,
  };
}

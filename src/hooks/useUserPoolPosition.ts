"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchUserPoolPosition, type UserPoolPosition } from "@/lib/api/pool";
import { fixtureUserPoolPosition } from "@/lib/fixtures/poolStats";
import { queryFnWithFixtureFallback } from "@/lib/query/fixtureFallback";

interface UserPositionState {
  data: UserPoolPosition | null;
  loading: boolean;
  isFixture: boolean;
}

/** Loads a connected wallet's pool position from GET /api/v1/pool/user/:address. No-ops until an address is provided. */
export function useUserPoolPosition(address: string | null): UserPositionState {
  const { data: result, isLoading } = useQuery({
    queryKey: ["userPoolPosition", address],
    enabled: Boolean(address),
    queryFn: ({ signal }) =>
      queryFnWithFixtureFallback(() => fetchUserPoolPosition(address!, signal), () => fixtureUserPoolPosition(address!), {
        signal,
      }),
  });

  if (!address) return { data: null, loading: false, isFixture: false };
  return { data: result?.data ?? null, loading: isLoading, isFixture: result?.isFixture ?? false };
}

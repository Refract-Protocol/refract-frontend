"use client";

import { useEffect, useState } from "react";
import { fetchUserPoolPosition, type UserPoolPosition } from "@/lib/api/pool";
import { fixtureUserPoolPosition } from "@/lib/fixtures/poolStats";
import { ApiUnreachableError } from "@/lib/api/client";

interface UserPositionState {
  data: UserPoolPosition | null;
  loading: boolean;
  isFixture: boolean;
}

/** Loads a connected wallet's pool position from GET /api/v1/pool/user/:address. No-ops until an address is provided. */
export function useUserPoolPosition(address: string | null): UserPositionState {
  const [state, setState] = useState<UserPositionState>({ data: null, loading: false, isFixture: false });

  useEffect(() => {
    if (!address) {
      setState({ data: null, loading: false, isFixture: false });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    fetchUserPoolPosition(address, controller.signal)
      .then((data) => setState({ data, loading: false, isFixture: false }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiUnreachableError) {
          setState({ data: fixtureUserPoolPosition(address), loading: false, isFixture: true });
          return;
        }
        setState({ data: null, loading: false, isFixture: false });
      });
    return () => controller.abort();
  }, [address]);

  return state;
}

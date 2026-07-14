"use client";

import { useMemo } from "react";
import type { Policy } from "@/lib/api/policies";
import type { ClaimRecord } from "@/lib/api/claims";
import { fixtureClaimsForHolder } from "@/lib/fixtures/claims";

/**
 * There is no backend route for claim history yet (see the TODO in
 * src/lib/api/claims.ts), so this always derives from the fixture rather
 * than pretending to call an endpoint that doesn't exist. Once
 * refract-backend adds one, this hook is the only place that needs to
 * change to a real fetch.
 */
export function useClaims(address: string | null, policies: Policy[] | null): ClaimRecord[] {
  return useMemo(() => {
    if (!address || !policies) return [];
    return fixtureClaimsForHolder(address, policies);
  }, [address, policies]);
}

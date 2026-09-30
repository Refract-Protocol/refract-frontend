"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchCoverageBounds } from "@/lib/api/policies";
import { fromStroops } from "@/lib/format";

interface CoverageBoundsState {
  /** Human USDC amounts, or null if unknown/unavailable — never fabricated. */
  minCoverage: number | null;
  maxCoverage: number | null;
}

const UNKNOWN_BOUNDS: CoverageBoundsState = { minCoverage: null, maxCoverage: null };

/**
 * Real on-chain read of the pool's actual min/max coverage (a single
 * global bound across every type — see fetchCoverageBounds). Deliberately
 * no fixture fallback: there's no meaningful synthetic answer for "what
 * can the pool currently accept", so a failed/unreachable read just
 * leaves both bounds null and callers fall back to the static per-type
 * catalog alone, same as before this hook existed.
 */
export function useCoverageBounds(): CoverageBoundsState {
  const { data } = useQuery({
    queryKey: ["coverageBounds"],
    queryFn: async ({ signal }): Promise<CoverageBoundsState> => {
      try {
        const { minCoverage, maxCoverage } = await fetchCoverageBounds(signal);
        return {
          minCoverage: minCoverage ? fromStroops(minCoverage) : null,
          maxCoverage: maxCoverage ? fromStroops(maxCoverage) : null,
        };
      } catch (err) {
        if (signal.aborted) throw err;
        return UNKNOWN_BOUNDS;
      }
    },
  });

  return data ?? UNKNOWN_BOUNDS;
}

"use client";

import { useEffect, useState } from "react";
import { fetchCoverageBounds } from "@/lib/api/policies";
import { fromStroops } from "@/lib/format";

interface CoverageBoundsState {
  /** Human USDC amounts, or null if unknown/unavailable — never fabricated. */
  minCoverage: number | null;
  maxCoverage: number | null;
}

/**
 * Real on-chain read of the pool's actual min/max coverage (a single
 * global bound across every type — see fetchCoverageBounds). Deliberately
 * no fixture fallback: there's no meaningful synthetic answer for "what
 * can the pool currently accept", so a failed/unreachable read just
 * leaves both bounds null and callers fall back to the static per-type
 * catalog alone, same as before this hook existed.
 */
export function useCoverageBounds(): CoverageBoundsState {
  const [state, setState] = useState<CoverageBoundsState>({ minCoverage: null, maxCoverage: null });

  useEffect(() => {
    const controller = new AbortController();
    fetchCoverageBounds(controller.signal)
      .then(({ minCoverage, maxCoverage }) => {
        setState({
          minCoverage: minCoverage ? fromStroops(minCoverage) : null,
          maxCoverage: maxCoverage ? fromStroops(maxCoverage) : null,
        });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState({ minCoverage: null, maxCoverage: null });
      });
    return () => controller.abort();
  }, []);

  return state;
}

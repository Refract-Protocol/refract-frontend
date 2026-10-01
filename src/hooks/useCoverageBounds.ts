"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCoverageBounds } from "@/lib/api/policies";
import { fromStroops } from "@/lib/format";

interface CoverageBoundsState {
  /** Human USDC amounts, or null if unknown/unavailable — never fabricated. */
  minCoverage: number | null;
  maxCoverage: number | null;
}

interface UseCoverageBoundsResult extends CoverageBoundsState {
  /** Re-runs the on-chain read, cancelling any in-flight request first. */
  refetch: () => Promise<void>;
  /** True while a request (initial or refetch) is in flight. */
  isLoading: boolean;
  /** True when the most recent read failed and bounds are unknown. */
  isError: boolean;
}

/**
 * Real on-chain read of the pool's actual min/max coverage (a single
 * global bound across every type — see fetchCoverageBounds). Deliberately
 * no fixture fallback: there's no meaningful synthetic answer for "what
 * can the pool currently accept", so a failed/unreachable read just
 * leaves both bounds null and callers fall back to the static per-type
 * catalog alone, same as before this hook existed.
 */
export function useCoverageBounds(): UseCoverageBoundsResult {
  const [state, setState] = useState<CoverageBoundsState>({ minCoverage: null, maxCoverage: null });
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  const mountedRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    if (mountedRef.current) {
      setIsLoading(true);
      setIsError(false);
    }

    try {
      const { minCoverage, maxCoverage } = await fetchCoverageBounds(controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      setState({
        minCoverage: minCoverage ? fromStroops(minCoverage) : null,
        maxCoverage: maxCoverage ? fromStroops(maxCoverage) : null,
      });
      setIsError(false);
    } catch {
      if (controller.signal.aborted || !mountedRef.current) return;
      setState({ minCoverage: null, maxCoverage: null });
      setIsError(true);
    } finally {
      if (!controller.signal.aborted && mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void run();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, [run]);

  return { ...state, refetch: run, isLoading, isError };
}

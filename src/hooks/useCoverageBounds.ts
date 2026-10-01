"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCoverageBounds } from "@/lib/api/policies";
import { ApiUnreachableError } from "@/lib/api/client";
import { readCoverageBounds } from "@/lib/stellar/rpc";
import { fromStroops } from "@/lib/format";
import type { DataSource } from "@/lib/api/dataSource";

interface CoverageBoundsState {
  /** Human USDC amounts, or null if unknown/unavailable — never fabricated. */
  minCoverage: number | null;
  maxCoverage: number | null;
  /** "api" or "chain" when known; null while loading or when both tiers failed (no fixture exists for this). */
  dataSource: DataSource | null;
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
 * The pool's actual min/max coverage (a single global bound across every
 * type — see fetchCoverageBounds): backend API first, then a direct Soroban
 * RPC read when the backend is unreachable. Deliberately no fixture tier:
 * there's no meaningful synthetic answer for "what can the pool currently
 * accept", so if both fail both bounds stay null and callers fall back to
 * the static per-type catalog alone.
 */
export function useCoverageBounds(): UseCoverageBoundsResult {
  const [state, setState] = useState<CoverageBoundsState>({ minCoverage: null, maxCoverage: null, dataSource: null });
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
      let dataSource: DataSource = "api";
      let bounds;
      try {
        bounds = await fetchCoverageBounds(controller.signal);
      } catch (err) {
        if (!(err instanceof ApiUnreachableError)) throw err;
        bounds = await readCoverageBounds(controller.signal);
        dataSource = "chain";
      }
      if (controller.signal.aborted || !mountedRef.current) return;
      const { minCoverage, maxCoverage } = bounds;
      setState({
        minCoverage: minCoverage ? fromStroops(minCoverage) : null,
        maxCoverage: maxCoverage ? fromStroops(maxCoverage) : null,
        dataSource,
      });
      setIsError(false);
    } catch {
      if (controller.signal.aborted || !mountedRef.current) return;
      setState({ minCoverage: null, maxCoverage: null, dataSource: null });
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

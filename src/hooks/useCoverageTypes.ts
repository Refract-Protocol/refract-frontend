"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCoverageTypes, type CoverageTypeInfo } from "@/lib/api/policies";
import { FIXTURE_COVERAGE_TYPES } from "@/lib/fixtures/coverageTypes";
import { ApiUnreachableError } from "@/lib/api/client";

interface CoverageTypesState {
  data: CoverageTypeInfo[] | null;
  loading: boolean;
  error: string | null;
  /** True when we fell back to the local fixture because the API was unreachable. */
  isFixture: boolean;
}

/**
 * Loads the coverage catalogue from GET /api/v1/policies/types, falling back
 * to the bundled fixture (src/lib/fixtures/coverageTypes.ts) when the
 * backend isn't reachable so the page still works end-to-end offline.
 *
 * Exposes a stable `refetch()` so callers can retry after a failure or a
 * fixture fallback without reloading the page.
 */
export function useCoverageTypes(): CoverageTypesState & { refetch: () => Promise<void> } {
  const [state, setState] = useState<CoverageTypesState>({
    data: null,
    loading: true,
    error: null,
    isFixture: false,
  });

  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState((prev) => ({ ...prev, loading: true }));

    try {
      const { coverageTypes } = await fetchCoverageTypes(controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      setState({ data: coverageTypes, loading: false, error: null, isFixture: false });
    } catch (err) {
      if (controller.signal.aborted || !mountedRef.current) return;
      if (err instanceof ApiUnreachableError) {
        setState({ data: FIXTURE_COVERAGE_TYPES, loading: false, error: null, isFixture: true });
        return;
      }
      setState({
        data: null,
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load coverage types",
        isFixture: false,
      });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, [load]);

  return { ...state, refetch: load };
}

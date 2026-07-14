"use client";

import { useEffect, useState } from "react";
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
 */
export function useCoverageTypes(): CoverageTypesState {
  const [state, setState] = useState<CoverageTypesState>({
    data: null,
    loading: true,
    error: null,
    isFixture: false,
  });

  useEffect(() => {
    const controller = new AbortController();

    fetchCoverageTypes(controller.signal)
      .then(({ coverageTypes }) => {
        setState({ data: coverageTypes, loading: false, error: null, isFixture: false });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
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
      });

    return () => controller.abort();
  }, []);

  return state;
}

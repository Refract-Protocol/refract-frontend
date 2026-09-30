"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchCoverageTypes, type CoverageTypeInfo } from "@/lib/api/policies";
import { FIXTURE_COVERAGE_TYPES } from "@/lib/fixtures/coverageTypes";
import { queryFnWithFixtureFallback } from "@/lib/query/fixtureFallback";

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
  const { data: result, isLoading } = useQuery({
    queryKey: ["coverageTypes"],
    queryFn: ({ signal }) =>
      queryFnWithFixtureFallback(
        async () => (await fetchCoverageTypes(signal)).coverageTypes,
        () => FIXTURE_COVERAGE_TYPES,
        { signal, errorMessage: "Failed to load coverage types" }
      ),
  });

  return { data: result?.data ?? null, loading: isLoading, error: result?.error ?? null, isFixture: result?.isFixture ?? false };
}

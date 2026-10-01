"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCoverageTypes, type CoverageTypeInfo } from "@/lib/api/policies";
import { FIXTURE_COVERAGE_TYPES } from "@/lib/fixtures/coverageTypes";
import { ApiUnreachableError } from "@/lib/api/client";
import { useCatalogStore } from "@/lib/store/catalogStore";

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
 * Backed by the shared catalog store so the landing page and /cover render
 * the same catalogue from a single fetch within the TTL.
 *
 * Exposes a stable `refetch()` so callers can retry after a failure or a
 * fixture fallback without reloading the page.
 */
export function useCoverageTypes(): CoverageTypesState & { refetch: () => Promise<void> } {
  const data = useCatalogStore((s) => s.coverageTypes);
  const loading = useCatalogStore((s) => s.loading);
  const error = useCatalogStore((s) => s.error);
  const isFixture = useCatalogStore((s) => s.isFixture);
  const load = useCatalogStore((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, isFixture, refetch: load };
}
}

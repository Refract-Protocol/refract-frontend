"use client";
import { useCallback, useState } from "react";
import { fetchCoverageTypes, type CoverageTypeInfo } from "@/lib/api/policies";
import { FIXTURE_COVERAGE_TYPES } from "@/lib/fixtures/coverageTypes";
import { useRealtimeTopic } from "./useRealtimeTopic";

export function useCoverageTypes() {
  const [error, setError] = useState<string | null>(null);
  const [isFixture, setFixture] = useState(false);
  const load = useCallback(async (signal: AbortSignal): Promise<CoverageTypeInfo[]> => {
    try {
      const response = await fetchCoverageTypes(signal);
      setError(null); setFixture(false); return response.coverageTypes;
    } catch (reason) {
      setFixture(true);
      setError(reason instanceof Error ? reason.message : "Coverage data unavailable");
      return FIXTURE_COVERAGE_TYPES;
    }
  }, []);
  const { data, isLoading, isStale } = useRealtimeTopic<CoverageTypeInfo[]>("coverage_types", load);
  return { data, loading: isLoading, error, isFixture, isStale };
}

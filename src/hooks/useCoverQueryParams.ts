"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  parseCoverQueryParams,
  serializeCoverQueryParams,
  type CoverQueryParams,
  type ParseQueryParamsOptions,
} from "@/lib/coverQueryParams";

export function useCoverQueryParams(
  currentState: CoverQueryParams,
  options: ParseQueryParamsOptions = {}
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMount = useRef(true);

  // Read initial values from URL on mount
  const getInitialParams = useCallback(() => {
    return parseCoverQueryParams(searchParams, options);
  }, [searchParams, options]);

  // Sync state to URL with debouncing (router.replace)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      const qs = serializeCoverQueryParams(currentState);
      const newUrl = qs ? `${pathname}?${qs}` : pathname;
      router.replace(newUrl, { scroll: false });
    }, 300);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [currentState, pathname, router]);

  return { getInitialParams };
}

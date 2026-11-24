import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  COVER_QUERY_KEYS,
  parseCoverQueryParams,
  type CoverQueryParams,
} from '@/lib/coverQueryParams';

const acceptedKeys = new Set<string>(COVER_QUERY_KEYS);

function warnUnknownKeys(searchParams: URLSearchParams): void {
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  const warned = new Set<string>();

  for (const key of searchParams.keys()) {
    if (acceptedKeys.has(key) || warned.has(key)) {
      continue;
    }

    warned.add(key);
    console.warn(
      `[useCoverQueryParams] Unknown query key "${key}". Accepted keys: ${COVER_QUERY_KEYS.join(', ')}.`,
    );
  }
}

export function useCoverQueryParams(): CoverQueryParams {
  const searchParams = useSearchParams();

  return useMemo(() => {
    warnUnknownKeys(searchParams);
    return parseCoverQueryParams(searchParams);
  }, [searchParams]);
}

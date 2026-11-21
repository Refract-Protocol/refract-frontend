import { useCallback, useEffect, useRef, useState } from "react";
import { usePolling } from "./usePolling";
import { useDocumentVisibility } from "./useDocumentVisibility";
import { fetchOracleStatus, type OracleStatus } from "../lib/api/oracle";

const ORACLE_STATUS_POLL_INTERVAL_MS = 30_000;

export interface UseOracleStatusResult {
  status: OracleStatus | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Polls the oracle status endpoint on a fixed interval, but pauses while the
 * document is hidden so we don't waste requests when the user isn't looking.
 * Polling resumes immediately when the tab becomes visible again.
 */
export function useOracleStatus(): UseOracleStatusResult {
  const [status, setStatus] = useState<OracleStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const isMountedRef = useRef(true);
  const visible = useDocumentVisibility();

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await fetchOracleStatus();
      if (!isMountedRef.current) return;
      setStatus(next);
      setError(null);
    } catch (err) {
      if (!isMountedRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, []);

  usePolling(load, ORACLE_STATUS_POLL_INTERVAL_MS, { enabled: visible });

  return { status, isLoading, error, refresh: load };
}

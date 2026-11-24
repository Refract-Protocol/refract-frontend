import { useCallback, useEffect, useRef, useState } from "react";
import { useDocumentVisibility } from "./useDocumentVisibility";

export interface OracleStatus {
  status: "ok" | "degraded" | "down" | "unknown";
  latencyMs: number | null;
  lastCheckedAt: number | null;
}

const POLL_INTERVAL_MS = 30_000;

const INITIAL_STATUS: OracleStatus = {
  status: "unknown",
  latencyMs: null,
  lastCheckedAt: null,
};

async function fetchOracleStatus(signal: AbortSignal): Promise<OracleStatus> {
  const startedAt = Date.now();
  const res = await fetch("/api/oracle/status", { signal });
  const latencyMs = Date.now() - startedAt;

  if (!res.ok) {
    return { status: "down", latencyMs, lastCheckedAt: Date.now() };
  }

  const data = (await res.json()) as { status?: OracleStatus["status"] };
  return {
    status: data.status ?? "unknown",
    latencyMs,
    lastCheckedAt: Date.now(),
  };
}

export function useOracleStatus(): OracleStatus {
  const [status, setStatus] = useState<OracleStatus>(INITIAL_STATUS);
  const visible = useDocumentVisibility();
  const controllerRef = useRef<AbortController | null>(null);

  const poll = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const next = await fetchOracleStatus(controller.signal);
      if (!controller.signal.aborted) setStatus(next);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setStatus({ status: "down", latencyMs: null, lastCheckedAt: Date.now() });
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      controllerRef.current?.abort();
      return;
    }

    // Resume immediately on visibility change, then poll on an interval.
    void poll();
    const id = window.setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(id);
      controllerRef.current?.abort();
    };
  }, [visible, poll]);

  return status;
}

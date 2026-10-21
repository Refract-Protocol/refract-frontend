"use client";

import { useEffect, useState } from "react";
import { ACTIVE_NETWORK } from "@/lib/network";
import {
  classifySample,
  nextHealth,
  type HealthSample,
  type NetworkHealth,
} from "@/lib/networkHealth";

const POLL_MS = 30_000;
const TIMEOUT_MS = 8_000;

export interface NetworkHealthState {
  health: NetworkHealth;
  ledgerAgeSec: number | undefined;
}

async function sampleNetwork(signal: AbortSignal): Promise<HealthSample> {
  const [horizon, rpc] = await Promise.allSettled([
    fetch(ACTIVE_NETWORK.horizonUrl, { signal }).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<{ history_latest_ledger_closed_at?: string }>;
    }),
    fetch(ACTIVE_NETWORK.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal,
    }).then((r) => r.ok),
  ]);
  const closedAt =
    horizon.status === "fulfilled" ? horizon.value.history_latest_ledger_closed_at : undefined;
  return {
    ledgerAgeSec: closedAt ? Math.max(0, (Date.now() - Date.parse(closedAt)) / 1000) : undefined,
    rpcOk: rpc.status === "fulfilled" && rpc.value,
  };
}

/** Polls Horizon + Soroban RPC liveness; pauses while the tab is hidden. Never throws into render. */
export function useNetworkHealth(): NetworkHealthState {
  const [state, setState] = useState<NetworkHealthState>({
    health: "healthy",
    ledgerAgeSec: undefined,
  });

  useEffect(() => {
    let streak = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | undefined;
    let cancelled = false;

    const run = async () => {
      if (cancelled || document.hidden) return;
      ctrl = new AbortController();
      const abort = setTimeout(() => ctrl?.abort(), TIMEOUT_MS);
      let sample: HealthSample;
      try {
        sample = await sampleNetwork(ctrl.signal);
      } catch {
        sample = { ledgerAgeSec: undefined, rpcOk: false };
      }
      clearTimeout(abort);
      if (cancelled) return;
      setState((prev) => {
        const next = nextHealth(prev.health, classifySample(ACTIVE_NETWORK.id, sample), streak);
        streak = next.streak;
        return { health: next.health, ledgerAgeSec: sample.ledgerAgeSec };
      });
      timer = setTimeout(run, POLL_MS);
    };

    const onVisibility = () => {
      if (!document.hidden && !timer) void run();
      if (document.hidden) {
        if (timer) clearTimeout(timer);
        timer = undefined;
        ctrl?.abort();
      }
    };

    void run();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return state;
}

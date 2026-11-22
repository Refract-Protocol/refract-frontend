/**
 * RealtimeConnectionStatus — connection status indicator for the Navbar.
 *
 * Shows a coloured dot + label reflecting the current realtime health.
 * While the circuit breaker is open, it shows a "REST only" pill.
 * Reduced-motion environments fall back to a static indicator.
 */
"use client";

import { useEffect, useState } from "react";
import { realtimeClient } from "@/lib/realtime/client";
import type { RealtimeHealth } from "@/lib/realtime/health";
import type { CircuitState } from "@/lib/realtime/circuitBreaker";

export interface RealtimeConnectionStatusProps {
  /** Override the client for stories and tests. */
  client?: typeof realtimeClient;
}

type DisplayState = "connected" | "connecting" | "reconnecting" | "degraded" | "error" | "rest-only";

function toDisplayState(health: RealtimeHealth, circuit: CircuitState): DisplayState {
  if (circuit === "open") return "rest-only";
  if (health === "healthy") return "connected";
  if (health === "degraded") return "degraded";
  return "error";
}

const LABEL: Record<DisplayState, string> = {
  connected: "Connected",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  degraded: "Degraded",
  error: "Disconnected",
  "rest-only": "REST only",
};

const DOT_CLASS: Record<DisplayState, string> = {
  connected: "bg-pm-green",
  connecting: "bg-pm-amber animate-pulse",
  reconnecting: "bg-pm-amber animate-pulse",
  degraded: "bg-pm-amber",
  error: "bg-pm-red",
  "rest-only": "bg-pm-violet",
};

const TEXT_CLASS: Record<DisplayState, string> = {
  connected: "text-pm-green",
  connecting: "text-pm-amber",
  reconnecting: "text-pm-amber",
  degraded: "text-pm-amber",
  error: "text-pm-red",
  "rest-only": "text-pm-violet",
};

export function RealtimeConnectionStatus({
  client = realtimeClient,
}: RealtimeConnectionStatusProps) {
  const [health, setHealth] = useState<RealtimeHealth>(() => client.health.get());
  const [circuit, setCircuit] = useState<CircuitState>(() => client.getCircuitState?.() ?? "closed");

  useEffect(() => {
    const offHealth = client.health.subscribe(() => {
      setHealth(client.health.get());
    });
    const offCircuit =
      typeof client.onCircuitStateChange === "function"
        ? client.onCircuitStateChange(setCircuit)
        : undefined;

    return () => {
      offHealth();
      offCircuit?.();
    };
  }, [client]);

  const display = toDisplayState(health, circuit);
  const dot = DOT_CLASS[display];
  const text = TEXT_CLASS[display];

  return (
    <div
      role="status"
      aria-label={`Realtime connection: ${LABEL[display]}`}
      className="flex items-center gap-1.5 select-none"
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${dot}`}
        aria-hidden="true"
      />
      <span className={`text-xs font-medium ${text}`}>{LABEL[display]}</span>
    </div>
  );
}

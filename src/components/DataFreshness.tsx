"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { getFreshness, type DataSource, type Freshness } from "@/lib/realtime/freshness";
import { realtimeClient } from "@/lib/realtime/client";

export function DataFreshness({
  updatedAt,
  source = "api",
  reconnecting = false,
  staleAfterMs = 30_000,
}: {
  updatedAt?: number | null;
  source?: DataSource;
  reconnecting?: boolean;
  staleAfterMs?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const [now, setNow] = useState<number | null>(null);
  const [connection, setConnection] = useState(realtimeClient.getConnectionState());
  const [everConnected, setEverConnected] = useState(false);
  const reconnectStarted = useRef<number | null>(null);
  useEffect(() => {
    const unsubscribe = realtimeClient.onConnectionState((state) => {
      setConnection(state);
      if (state === "connected") {
        setEverConnected(true);
        reconnectStarted.current = null;
      } else if (reconnectStarted.current === null) reconnectStarted.current = Date.now();
    });
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 2_000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);
  const graceStarted =
    everConnected && connection !== "connected" ? reconnectStarted.current : null;
  const freshness: Freshness =
    now === null ? "unknown" : getFreshness(updatedAt ?? null, now, staleAfterMs, graceStarted);
  const withinReconnectGrace =
    everConnected &&
    connection !== "connected" &&
    reconnectStarted.current !== null &&
    now !== null &&
    now - reconnectStarted.current < 5_000;
  const displayedFreshness = freshness;
  const age = updatedAt && now !== null ? Math.max(0, Math.floor((now - updatedAt) / 1000)) : null;
  const label = reconnecting
    ? "Reconnecting"
    : source === "fixture"
      ? "Offline data"
      : source !== "realtime"
        ? source === "chain"
          ? "On-chain data"
          : "REST data"
        : displayedFreshness === "fresh"
          ? "Live"
          : displayedFreshness === "aging"
            ? "Updating"
            : displayedFreshness === "stale"
              ? `Updated ${age}s ago`
              : "Waiting for data";
  const tone =
    reconnecting ||
    (everConnected && connection !== "connected" && !withinReconnectGrace) ||
    displayedFreshness === "stale"
      ? "muted"
      : displayedFreshness === "fresh" && source === "realtime"
        ? "live"
        : "quiet";
  return (
    <span
      className={`data-freshness data-freshness--${tone}`}
      title={updatedAt ? `Last updated ${new Date(updatedAt).toLocaleTimeString()}` : undefined}
    >
      <span
        aria-hidden="true"
        className={`data-freshness__dot${tone === "live" && !reduced ? " data-freshness__dot--pulse" : ""}`}
      />
      <span>{label}</span>
    </span>
  );
}

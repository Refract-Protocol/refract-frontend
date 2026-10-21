"use client";

import { ACTIVE_NETWORK } from "@/lib/network";
import { useNetworkHealth } from "@/hooks/useNetworkHealth";

const LABEL = { healthy: "Healthy", degraded: "Degraded", unavailable: "Unavailable" } as const;
const COLOR = {
  healthy: "bg-green-500",
  degraded: "bg-yellow-500",
  unavailable: "bg-red-500",
} as const;

/** Navbar network badge with a live health state; text label, not colour alone. */
export function NetworkBadge() {
  const { health, ledgerAgeSec } = useNetworkHealth();
  const age = ledgerAgeSec === undefined ? "unknown" : `${Math.round(ledgerAgeSec)}s ago`;
  return (
    <a
      href={ACTIVE_NETWORK.explorerBaseUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={`${ACTIVE_NETWORK.label}: ${LABEL[health]} — last ledger closed ${age}`}
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
    >
      <span aria-hidden className={`h-2 w-2 rounded-full ${COLOR[health]}`} />
      {ACTIVE_NETWORK.badge} · {LABEL[health]}
    </a>
  );
}

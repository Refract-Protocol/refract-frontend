import { useNetworkHealth } from "@/hooks/useNetworkHealth";
import type { StellarNetworkId } from "@/lib/network";
import type { HealthSample } from "@/lib/networkHealth";

interface NetworkBadgeProps {
  network: StellarNetworkId;
  fetchSample: () => Promise<HealthSample>;
}

const STYLES: Record<string, string> = {
  healthy: "bg-green-500/15 text-green-400 border-green-500/30",
  degraded: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  unavailable: "bg-red-500/15 text-red-400 border-red-500/30",
  unreachable: "bg-red-500/15 text-red-400 border-red-500/30",
};

const LABELS: Record<string, string> = {
  healthy: "healthy",
  degraded: "degraded",
  unavailable: "unavailable",
  unreachable: "unreachable",
};

export function NetworkBadge({ network, fetchSample }: NetworkBadgeProps) {
  const { health, error } = useNetworkHealth(network, fetchSample);
  const variant = error ? "unreachable" : health;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STYLES[variant]}`}
      title={error ? error.message : undefined}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABELS[variant]}
    </span>
  );
}

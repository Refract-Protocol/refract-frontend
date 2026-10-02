import type { PoolStats } from "@/lib/api/pool";

export interface CapacityInput {
  /** Catalogue maximum for the selected coverage type, in USDC. */
  catalogueMax: number;
  /** Global on-chain coverage bound, in USDC. */
  onChainMax: number;
  /** Pool stats, or null when they could not be loaded. */
  poolStats: PoolStats | null;
  /** True when pool stats came from the bundled fixture rather than the API. */
  isFixture?: boolean;
}

export interface CapacityResult {
  /** The effective maximum coverage the buyer may request right now. */
  effectiveMax: number;
  /** Remaining capacity the pool can currently write, clamped to zero. */
  remainingCapacity: number;
  /** Which constraint is the binding one, or null when capacity is unknown. */
  bindingConstraint: "catalogue" | "onChain" | "pool" | null;
  /** True when pool stats were unavailable and capacity could not be verified. */
  capacityUnverified: boolean;
  /** True when the pool has no free capacity to write new coverage. */
  coverageUnavailable: boolean;
}

/**
 * Computes the maximum coverage the pool can currently write, reconciling the
 * catalogue max, the global on-chain bound and the pool's free capacity
 * (respecting maxUtilizationBps).
 *
 * Utilization is expressed in basis points and can legitimately exceed the
 * maximum after payouts; negative remaining capacity clamps to zero and yields
 * a `coverageUnavailable` state rather than a negative maximum.
 */
export function computeCapacity(input: CapacityInput): CapacityResult {
  const { catalogueMax, onChainMax, poolStats, isFixture = false } = input;

  const boundsMax = Math.min(catalogueMax, onChainMax);
  const boundsConstraint: "catalogue" | "onChain" =
    catalogueMax <= onChainMax ? "catalogue" : "onChain";

  // Fixture-derived stats must not be presented as a verified capacity limit.
  if (!poolStats || isFixture) {
    return {
      effectiveMax: boundsMax,
      remainingCapacity: 0,
      bindingConstraint: boundsConstraint,
      capacityUnverified: true,
      coverageUnavailable: false,
    };
  }

  const maxUtilizationBps = poolStats.maxUtilizationBps;
  const maxUtilizedUsdc = (poolStats.availableUsdc + poolStats.lockedUsdc) * (maxUtilizationBps / 10_000);
  const remainingCapacity = Math.max(0, Math.floor(maxUtilizedUsdc - poolStats.lockedUsdc));

  const coverageUnavailable = remainingCapacity <= 0;
  const poolIsBinding = remainingCapacity < boundsMax;

  return {
    effectiveMax: poolIsBinding ? remainingCapacity : boundsMax,
    remainingCapacity,
    bindingConstraint: poolIsBinding ? "pool" : boundsConstraint,
    capacityUnverified: false,
    coverageUnavailable,
  };
}

export function describeBindingConstraint(constraint: CapacityResult["bindingConstraint"]): string {
  switch (constraint) {
    case "catalogue":
      return "the maximum for this coverage type";
    case "onChain":
      return "the on-chain coverage limit";
    case "pool":
      return "the pool's available capacity";
    default:
      return "the available limits";
  }
}

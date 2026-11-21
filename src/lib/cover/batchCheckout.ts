import type { PendingPolicy } from "@/lib/realtime/pendingPolicies";

export type BatchCheckoutPolicy = {
  id: string;
  premium: number;
  label?: string;
};

export type DroppedPolicy = {
  policy: BatchCheckoutPolicy;
  reason: "insufficient_balance";
};

export type BatchCheckoutResult = {
  affordable: BatchCheckoutPolicy[];
  dropped: DroppedPolicy[];
  totalPremium: number;
  affordablePremium: number;
  balance: number;
};

/**
 * Pre-flight balance check for a batch checkout.
 *
 * Partitions the selected policies into those the wallet balance can cover and
 * those that must be dropped. Policies are considered in the given order and
 * kept while the running premium total stays within the balance. This does not
 * alter the on-chain transaction shape — it only decides what to build.
 */
export function batchCheckout(
  policies: BatchCheckoutPolicy[],
  balance: number,
): BatchCheckoutResult {
  const affordable: BatchCheckoutPolicy[] = [];
  const dropped: DroppedPolicy[] = [];
  let affordablePremium = 0;
  let totalPremium = 0;

  for (const policy of policies) {
    totalPremium += policy.premium;
    if (affordablePremium + policy.premium <= balance) {
      affordablePremium += policy.premium;
      affordable.push(policy);
    } else {
      dropped.push({ policy, reason: "insufficient_balance" });
    }
  }

  return { affordable, dropped, totalPremium, affordablePremium, balance };
}

export type { PendingPolicy };

import type { Policy } from "@/lib/api/policies";

/**
 * FIXTURE — not live data.
 *
 * GET /api/v1/policies/holder/:address is a real backend route (see
 * refract-backend/src/routes/policies.ts), but its in-memory store starts
 * empty on every process restart, so any address will legitimately return
 * no policies today. This generator produces a plausible policy history for
 * a given holder so the dashboard can be exercised end-to-end while the
 * API is unreachable (or simply has nothing recorded yet) — it is only
 * ever used as an explicit fallback, never presented as real chain state.
 */
export function fixtureHolderPolicies(holder: string): Policy[] {
  const now = Date.now();
  const day = 86_400_000;

  const base: Array<Pick<Policy, "coverageType" | "coverageTypeName" | "coverageAmount" | "durationDays"> & {
    createdDaysAgo: number;
    active: boolean;
  }> = [
    { coverageType: 0, coverageTypeName: "Stablecoin Depeg", coverageAmount: (5_000 * 1e7).toString(), durationDays: 60, createdDaysAgo: 12, active: true },
    { coverageType: 1, coverageTypeName: "Market Crash", coverageAmount: (12_000 * 1e7).toString(), durationDays: 30, createdDaysAgo: 4, active: true },
    { coverageType: 2, coverageTypeName: "Liquidation Shield", coverageAmount: (8_500 * 1e7).toString(), durationDays: 45, createdDaysAgo: 20, active: false },
    { coverageType: 3, coverageTypeName: "Smart Contract Risk", coverageAmount: (25_000 * 1e7).toString(), durationDays: 90, createdDaysAgo: 30, active: true },
    { coverageType: 4, coverageTypeName: "Flight Delay", coverageAmount: (1_200 * 1e7).toString(), durationDays: 3, createdDaysAgo: 40, active: false },
  ];

  return base.map((p, i) => {
    const createdAt = now - p.createdDaysAgo * day;
    const expiresAt = Math.floor((createdAt + p.durationDays * day) / 1000);
    const annualRate = [0.03, 0.045, 0.06, 0.09, 0.024][p.coverageType];
    const premium = (Number(p.coverageAmount) * annualRate * (p.durationDays / 365)).toFixed(0);

    return {
      id: `fixture-policy-${i}`,
      holder,
      coverageType: p.coverageType,
      coverageTypeName: p.coverageTypeName,
      coverageAmount: p.coverageAmount,
      premium,
      durationDays: p.durationDays,
      expiresAt,
      isActive: p.active && expiresAt * 1000 > now,
      createdAt: new Date(createdAt).toISOString(),
    };
  });
}

/** p50/p95 budgets in ms per topic class; see docs/realtime-latency-slo.md. */
export const LATENCY_BUDGET_MS: Record<string, { p50: number; p95: number }> = {
  oracle_update: { p50: 250, p95: 1000 },
  quote: { p50: 250, p95: 1000 },
  notification: { p50: 500, p95: 2000 },
  clock: { p50: 250, p95: 1000 },
};

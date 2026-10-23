import { expect, it } from "vitest";
import { compilePattern } from "./topics";

// Report time without a machine-dependent latency assertion.
it("benchmarks routing 1,000 events against 256 compiled subscriptions", () => {
  const patterns = Array.from({ length: 256 }, (_, i) => compilePattern(`pool.${i}.*`));
  const start = performance.now();
  let deliveries = 0;
  for (let event = 0; event < 1000; event++) {
    for (const matches of patterns) if (matches("pool.123.claim")) deliveries++;
  }
  const elapsed = performance.now() - start;
  console.info(`Realtime matcher: 256,000 comparisons in ${elapsed.toFixed(2)}ms`);
  expect(deliveries).toBe(1000);
});

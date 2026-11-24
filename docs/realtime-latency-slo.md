# Realtime latency SLO

**Measured interval:** backend event timestamp (`ts` on the message, server clock) → the moment the
subscribed handler has delivered the decoded payload (client receive → store write). Component commit
adds one frame (~16 ms) and is covered by the e2e paint check. Server/client skew is removed using the
offset from the `clock` topic (`src/lib/realtime/clock.ts`); until synced, the client clock is used and
results are treated as indicative only.

The first event after connect (warm-up) is excluded from percentiles.

## Render-commit budgets

The committed baseline in `reports/realtime-benchmark-baseline.json` records React commit
duration under a 100-oracle-push workload at 25 Hz across the landing page, `/cover`, and `/provide`
(median of five browser runs).

| Metric | Budget |
| --- | --- |
| Median commit duration | 16 ms |
| p95 commit duration | 50 ms |
| Long-task count | 0 |
| p98 interaction duration | 200 ms |

`scripts/realtime-benchmark.mjs` runs the browser workload and exits non-zero if any measured
value exceeds the corresponding budget. These numbers are regression guards, not performance
guarantees.

## End-to-end latency assertions

Budgets for the full server-event → store-write path live in `src/lib/realtime/latencyBudget.ts`
and are asserted by `src/lib/realtime/latency.test.ts`, which fails with a per-topic diff and
also fails on zero samples.

# Data-usage accounting

`src/lib/realtime/metrics.ts` counts UTF-8 bytes of decoded text frames per topic and direction at the
client decode point. Frame/header/TLS overhead and permessage-deflate savings are not reflected. Totals
are cumulative for the page session and are **not** reset on reconnect. View them at `/dev/realtime`.

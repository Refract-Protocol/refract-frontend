# Realtime latency SLO

**Measured interval:** backend event timestamp (`ts` on the message, server clock) → the moment the
subscribed handler has delivered the decoded payload (client receive → store write). Component commit
adds one frame (~16 ms) and is covered by the e2e paint check. Server/client skew is removed using the
offset from the `clock` topic (`src/lib/realtime/clock.ts`); until synced, the client clock is used and
results are treated as indicative only.

The first event after connect (warm-up) is excluded from percentiles.

| Topic class | Examples | p50 | p95 |
| --- | --- | --- | --- |
| Oracle readings | `oracle_update` | 250 ms | 1000 ms |
| Quotes / pricing | `quote` | 250 ms | 1000 ms |
| Notifications | toasts | 500 ms | 2000 ms |
| Clock / boundary | `clock` | 250 ms | 1000 ms |

These are **targets** (regression guards with generous multipliers for noisy CI), not measured values.
Budgets live in `src/lib/realtime/latencyBudget.ts` and are asserted by
`src/lib/realtime/latency.test.ts`, which fails with a per-topic diff and also fails on zero samples.

> **Note on the benchmark baseline:** `reports/realtime-benchmark-baseline.json` records a separate,
> complementary set of measurements — component-commit duration (`medianCommitDurationMs`,
> `p95CommitDurationMs`), long-task count, and interaction latency — produced by
> `scripts/realtime-benchmark.mjs` running 100 oracle pushes at 25 Hz across five browser runs.
> Those figures measure client-side rendering performance (store write → paint), not the network
> hop measured by this SLO table, so the two data sets are not directly comparable. To regenerate
> the baseline, run `node scripts/realtime-benchmark.mjs` with a local server and commit the
> updated JSON.

# Data-usage accounting

`src/lib/realtime/metrics.ts` counts UTF-8 bytes of decoded text frames per topic and direction at the
client decode point. Frame/header/TLS overhead and permessage-deflate savings are not reflected. Totals
are cumulative for the page session and are **not** reset on reconnect. View them at `/dev/realtime`.

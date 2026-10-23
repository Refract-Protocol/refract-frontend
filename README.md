# Refract Frontend

> The web app for [Refract](https://github.com/refract-protocol) — buy parametric coverage and provide risk capital, on Stellar.

A Next.js (App Router) interface for two audiences: **policyholders** who buy
oracle-triggered coverage, and **capital providers** who underwrite the risk
pool and earn premium yield. See also `refract-contracts` and `refract-backend`.

## Stack

- **Next.js 14** (App Router) + **React 18**
- **Tailwind CSS** with a custom violet design system (`src/app/globals.css`)
- **CSS motion system** for animation (see `src/app/globals.css`), **Zustand** for client state

## Motion

Animation is handled entirely in CSS via the documented motion section of
`src/app/globals.css` (named duration/easing tokens plus the `fadeUp`,
`shieldPulse`, `pmShimmer`, and `spin` keyframes). Reduced motion is honoured by
`usePrefersReducedMotion` (`src/hooks/usePrefersReducedMotion.ts`) as the single
JS-side source of truth, with the `prefers-reduced-motion` override in
`globals.css` as the belt-and-braces fallback. No component animates outside
this policy.

## Routes

| Path | Page |
|---|---|
| `/` | Landing — live oracle status, recent payouts, protocol stats |
| `/cover` | Policy purchase flow |
| `/provide` | LP capital provision + pool allocation |

## Quick start

```bash
npm install
npm run dev      # http://localhost:3000
```

Data is fetched from `refract-backend` over REST (default `http://localhost:4001`,
configurable via `NEXT_PUBLIC_API_URL`). On top of that REST path the app has an
**optional realtime layer** (`src/lib/realtime/`) that can push updates over a
WebSocket instead of polling. Realtime is **off by default** and gated behind
feature flags (`public/flags.json`); when it is disabled, unavailable, or the
connection drops, the app transparently falls back to the REST path — so the
REST API remains the source of truth. See
[`docs/realtime/`](./docs/realtime/) for the topic contract, connection
lifecycle, fallback semantics, flag matrix, and the operational runbook.

Other environment variables:

- `NEXT_PUBLIC_REALTIME_URL` — optional `ws://`/`wss://` URL. With the `realtime-oracle` flag on,
  `useOracleStatus` streams the `oracle.readings` topic from it (REST remains the initial load and
  the automatic fallback; the landing page shows a stale notice while the stream is down).
- `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_FLAGS_OVERRIDE` (JSON object of booleans),
  `NEXT_PUBLIC_ENABLE_UI_GALLERY` (`true`/`false`) — dev/mocking helpers.

All `NEXT_PUBLIC_*` variables are validated once at startup by `src/lib/env.ts`; a malformed value
fails fast with a message naming the variable and what was expected. Read env through `env`, not
`process.env`. Copy `.env.example` to `.env.local` to get started.

- `NEXT_PUBLIC_STELLAR_NETWORK` — `testnet` (default), `futurenet` or `mainnet`. Drives
  the Navbar network badge, explorer links and Horizon URL (`src/lib/network.ts`). An
  unrecognized value fails the build.
- `NEXT_PUBLIC_POOL_CONTRACT_ID` / `NEXT_PUBLIC_POLICY_CONTRACT_ID` — Refract contract IDs
  used to filter the Dashboard's Transaction History (read client-side from public Horizon
  `/accounts/{address}/operations`, paged by cursor, retried with backoff on 429/5xx). When
  unset, every Soroban contract call by the wallet is listed.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | `next lint` |
| `npm run typecheck` | `tsc --noEmit` |

## Monitoring

Runtime errors are reported to Sentry when `NEXT_PUBLIC_SENTRY_DSN` is set. See
[docs/monitoring.md](docs/monitoring.md) for configuration and the data-scrubbing policy.

## License

[MIT](./LICENSE)

## Realtime layer (dev)

Realtime is off by default (`public/flags.json`; see `docs/realtime-protocol.md` and `docs/realtime-rollout.md`).
Run the deterministic mock server with `npm run mock:realtime` (prints `MOCK_REALTIME_URL=…`; add `--port=4010`).
Scenario flags: `--seed=N --count=N --dropAfter=N --latencyMs=N --duplicate --reorder --unknown --authFail`, or the same as query params on the WebSocket URL.
Playwright starts it on port 4010 automatically; point the app at it with `NEXT_PUBLIC_API_URL=http://127.0.0.1:4010/api/v1`
and `NEXT_PUBLIC_FLAGS_OVERRIDE='{"realtime-enabled":true,"realtime-oracle":true}'`.

## Handsoff notes

<!-- handsoff-issue-218 -->
- #218: Stream On-Chain Transaction Confirmation Status for User-Submitted Actions

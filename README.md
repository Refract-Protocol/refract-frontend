# Refract Frontend

> The web app for [Refract](https://github.com/refract-protocol) — buy parametric coverage and provide risk capital, on Stellar.

A Next.js (App Router) interface for two audiences: **policyholders** who buy
oracle-triggered coverage, and **capital providers** who underwrite the risk
pool and earn premium yield. See also `refract-contracts` and `refract-backend`.

## Stack

- **Next.js 14** (App Router) + **React 18**
- **Tailwind CSS** with a custom violet design system (`src/app/globals.css`)
- **Framer Motion** for animation, **Zustand** for client state

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

The app talks to `refract-backend` (default `http://localhost:4001`). Point it at
your backend with `NEXT_PUBLIC_API_URL` if needed.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | `next lint` |
| `npm run typecheck` | `tsc --noEmit` |

## License

[MIT](./LICENSE)

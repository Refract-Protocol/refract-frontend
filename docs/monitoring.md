# Error monitoring (Sentry)

Runtime errors are reported with `@sentry/nextjs` (client, server and edge runtimes, plus the
`src/app/error.tsx` and `src/app/global-error.tsx` boundaries, tagged `boundary: app-error` /
`global-error`). Sentry is a complete no-op when `NEXT_PUBLIC_SENTRY_DSN` is unset, so local
development, forks and CI need no configuration.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel | Enables reporting. Unset = disabled. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | Vercel / CI | Environment tag. Falls back to `NODE_ENV`. |
| `NEXT_PUBLIC_SENTRY_RELEASE` | set automatically | Release name (git SHA). |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | GitHub secrets / Vercel | Source map upload. |

Source maps are uploaded during `next build` only when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and
`SENTRY_PROJECT` are all set; otherwise the build runs normally without uploading.

## Required GitHub secrets

`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (read by the Build step in
`.github/workflows/ci.yml`). Add `NEXT_PUBLIC_SENTRY_DSN` to the Vercel project.

## Environment tagging

`environment` = `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, else `NODE_ENV`. Reporting is disabled when the
environment is `development`. CI builds set `production` on `main` and `ci` otherwise.

## Releases

`release` = `NEXT_PUBLIC_SENTRY_RELEASE`, which `next.config.js` fills from
`VERCEL_GIT_COMMIT_SHA` or `GITHUB_SHA` (CI sets it to `github.sha`). Uploaded source maps are
attached to that release, so each error maps to an exact commit with a readable stack trace.

## Data scrubbing

A single `beforeSend` (`src/lib/monitoring/scrub.ts`) runs in all three runtimes. `sendDefaultPii`
is off and session replay is not enabled.

**Kept:** Stellar public keys (`G` + 55 characters; public on-chain data), error messages and
stack traces.

**Redacted / removed:**
- Stellar secret seeds (`S` + 55 characters) anywhere in the event, replaced with `[Filtered]`
- `Authorization`, `Cookie` and `Set-Cookie` request headers; request cookies
- Request bodies
- URL query strings (request URL, query string, and breadcrumb URLs)
- User email and IP address

## Sentry initialisation entry points

Sentry is initialised once per runtime from three files at the repo root:

| File | Runtime |
|---|---|
| `sentry.client.config.ts` | Browser (Next.js client bundle) |
| `sentry.server.config.ts` | Node.js server (API routes, SSR) |
| `sentry.edge.config.ts` | Edge runtime (middleware) |

Each entry point calls `Sentry.init()` and wires the `beforeSend` hook to the
scrubber in `src/lib/monitoring/scrub.ts`. **When adding a new field to a Sentry
event**, check whether it contains PII or secrets — if it does, add a scrub rule
to `src/lib/monitoring/scrub.ts` before shipping, then update the "Kept" /
"Redacted" lists in the Data scrubbing section above.

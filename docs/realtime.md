# Realtime

The app can receive pushed updates over a WebSocket (`src/lib/realtime/`). Realtime is
**best-effort**: every view keeps a REST fetch as its source of truth, and realtime only
makes that data fresher. The connection is off unless the `realtime` feature flag is on
(`realtime-oracle` is accepted as a legacy alias).

| Module | Role |
| --- | --- |
| `realtime/contract.ts` | Topics, wire format, per-version payload parsers |
| `realtime/decode.ts` | Parse boundary: version dispatch, typed errors |
| `realtime/errors.ts` | Error taxonomy (`parse`, `validation`, `unsupported_version`, `connection`, `retries_exhausted`) |
| `realtime/client.ts` | Reconnecting client, scope epochs, subscriptions |
| `realtime/health.ts` | Observable health (`healthy` / `degraded` / `unavailable`) |
| `realtime/reporter.ts` | Sentry reporting behind a small interface |
| `realtime/RealtimeScopeSync.tsx` | Binds wallet account + network to the client |
| `polling/adaptivePolling.ts` | REST fallback cadence policy |

## Topics

| Topic | Scope | Versions | Consumer |
| --- | --- | --- | --- |
| `oracle_update` | global | 1, 2 | `useOracleStatus` |
| `claim_settled` | global | 1 | `useRecentClaims` |
| `holder_claim` | account | 1 | `useClaims` |

## Versioning

Every data frame carries an integer version: `{ "topic", "v", "payload", "scope"? }`.

- **Decode boundary.** `decodeFrame` looks up a parser by `(topic, v)` in the registry in
  `contract.ts`. Each parser normalises its version to the current in-app type, so
  consumers never branch on versions. The version is never guessed from which fields are
  present.
- **Missing `v`.** Treated as version 1, the shape servers sent before versioning, during
  the transition period. It is not an error.
- **Unknown `v`.** Raises `UnsupportedVersionError`, which is **not retryable**. The topic
  degrades to REST for the rest of the session (or until the scope changes): the client
  unsubscribes, marks the topic `unavailable` so polling tightens, and reports once.
- **Negotiation.** On subscribe the client advertises what it can decode, newest first:
  `{ "type": "subscribe", "topic", "versions": [2, 1], "scope" }`. A server that can't serve
  any of them replies `{ "type": "error", "code": "unsupported_version", "topic" }` and the
  client degrades that topic to REST instead of retrying.

### Changing a payload

**Additive (non-breaking) — same version.** Adding an optional field that old bundles can
ignore. Parsers use non-strict object schemas, so unknown fields pass through. Clients don't
need to change first.

**Breaking — new version.** Removing or renaming a field, changing a type or meaning, or
making an optional field required.

1. Add a `v(N+1)` parser to the topic in `contract.ts` that normalises to the in-app type,
   with a fixture in `decode.test.ts`. Ship the frontend first.
2. The backend emits `v(N+1)` only to subscribers that advertise it, and keeps serving `vN`
   to everyone else.
3. **Deprecation window.** Keep serving `vN` for at least **30 days** after the frontend
   that understands `v(N+1)` is deployed. Browser tabs live a long time, and an old bundle
   that loses its version falls back to REST rather than breaking, but that is still a
   degradation.
4. After the window, the backend may stop serving `vN`. Remove the `vN` parser from the
   frontend in a later release.

Never reuse a version number for a different shape.

## Scope: account and network switches

Every subscription is made under a **scope** (network + connected account), and each scope
has an **epoch** number. `RealtimeScopeSync` keeps the scope in step with the wallet.

When the account or network changes:

1. Delivery stops at once, so no frame is handed to consumers while the switch is pending.
2. After a 250 ms debounce (rapid toggling never opens parallel connections), the epoch is
   bumped, per-identity buffers are cleared, the socket is closed, and a fresh one
   re-subscribes under the new scope.
3. Frames from the old socket or epoch are dropped, including ones queued just before the
   teardown. Frames whose `scope` label doesn't match are dropped too.
4. Realtime-merged and wallet-scoped queries (`SCOPED_QUERY_ROOTS` in `realtime/scope.ts`)
   are reset, so old-scope snapshots are never shown next to new-scope realtime data.
5. `useRealtimeTopic` checks the epoch and account again when it delivers a frame.

Token expiry for an unchanged identity is out of scope here.

## REST fallback polling

Hooks don't pick their own intervals. They call `useAdaptivePolling({ topic, tier })`, and
the interval follows that topic's realtime health:

| Tier | healthy | degraded / unavailable | Used by |
| --- | --- | --- | --- |
| critical | 5 min | 60 s | `useOracleStatus`, `useClaims` |
| standard | 10 min | 2 min | `useRecentClaims` |
| background | 15 min | 5 min | `useNotifications` (time-window re-derive) |

- **Hysteresis.** Worse health tightens polling at once. Better health only widens it after
  holding for 30 s, so a flapping connection keeps the tight cadence.
- **Recovery.** When recovery is confirmed, the in-flight poll is cancelled
  (`cancelQueries`) instead of finishing its cycle.
- **Hidden tabs.** Interval polling pauses while the tab is hidden (TanStack's default
  `refetchIntervalInBackground: false`).
- **No realtime.** With the flag off, or after reconnects are exhausted, health is
  `unavailable` and REST polls at the tight cadence. That is close to the old fixed
  intervals.

The policy table is `POLL_INTERVALS` in `polling/adaptivePolling.ts`, the only place cadence
is defined. `createAdaptivePoller` applies the same policy outside React.

## Error reporting

The client reports only through `RealtimeReporter` (`captureError`, `addBreadcrumb`). The
default reporter forwards to `globalThis.Sentry` when the SDK is loaded (the SDK itself is
#145) and does nothing otherwise.

- **Errors** carry tags `realtime.kind`, `realtime.topic`, `realtime.transport`,
  `realtime.attempt`, `realtime.fallback` and `realtime.retryable`, plus a fingerprint of
  `["realtime", kind, topic]`.
- **Breadcrumbs** (category `realtime`) record lifecycle events: `connecting`, `open`,
  `reconnect_scheduled`, `fallback_engaged`, `closed`, `scope_changed`.
- **Dedup and rate limits.** Errors are deduplicated per topic + kind for 5 minutes, and the
  suppressed count is attached to the next event. Breadcrumbs are capped at 20 per minute,
  and identical consecutive ones are collapsed. A reconnect storm therefore produces one
  event, not one per attempt.
- **Scrubbing.** Bearer tokens, JWTs, `token=`-style secrets, sensitive keys (`*token*`,
  `auth`, `signature`, `xdr`, …) and Stellar account addresses are redacted from messages,
  stacks, tags and data. An error's `cause` (which may hold the raw frame) is never sent.

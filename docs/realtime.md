# Realtime layer

How the frontend talks to the Refract backend's push channel, and the guardrails around it. Code lives in `src/lib/realtime/`.

> **Status:** the realtime backend contract is *documented, not yet implemented
> upstream*. The client code in `src/lib/realtime/` is written against the
> contract below, but `refract-backend` does not yet serve it. Until it does,
> the layer stays behind feature flags (see the flag matrix) and every
> consumer falls back to REST.

## Modules

| Module | Role | Loaded |
| --- | --- | --- |
| `load.ts` | `loadRealtime()`: the only way UI code reaches the client | eagerly (tiny) |
| `entry.ts` | Lazy entry: `getRealtimeClient()`, `parsePolicyEvent()` | lazily, `realtime` chunk |
| `client.ts` | Reconnecting WebSocket client, heartbeat, diagnostics | lazily, via `entry.ts` |
| `codec.ts` | Frame decoding + size guard shared by all transports | lazily, via `client.ts` |
| `clockOffset.ts` | Server/client clock-offset estimator, `normalizeServerTs` | eagerly (small, no deps) |
| `topics.ts` | Topic names | eagerly |
| `policyEvents.ts` | zod schemas for `policy.<address>` payloads | lazily, via `entry.ts` |
| `pendingPolicies.ts` | Pending-purchase state machine + persisted store | eagerly (used by /cover) |
| `dev/` | Test/dev tooling (fake socket). **Never shipped.** | tests only |

## Wire contract

Every frame is JSON: `{ "topic": string, "payload": unknown, "ts"?: number }`. `ts` is the server clock in ms since epoch.

### Control topics

| Topic | Direction | Payload |
| --- | --- | --- |
| `refract.ping` | client → server | `{ t0 }`: client clock when sent |
| `refract.pong` | server → client | `{ t0, serverTs }`: echo of `t0` plus the server clock |
| `refract.wire_stats` | server → client | `{ compressedBytes, uncompressedBytes }`, cumulative for the connection (optional) |

The client pings on connect and every 25 s (`HEARTBEAT_INTERVAL_MS`). Control topics are never delivered to `subscribe()` handlers.

### `policy.<address>` (#246)

One topic per wallet. Payloads are discriminated by `type`. All of them carry `holder` and `ts`.

| `type` | Meaning | Ids |
| --- | --- | --- |
| `accepted` | Backend saw the purchase transaction | `txHash` (+ `policyId?`) |
| `issued` | Policy is on-chain and active | `txHash`, `policyId` (+ `coverageTypeName?`, `coverageAmount?`, `premium?`, `expiresAt?`) |
| `premium_charged` | A premium charge was recorded | `policyId`, `amount` |
| `cancelled` | Policy cancelled after issuance | `policyId`, `reason` ∈ `holder_requested \| pool_insufficient \| expired \| oracle_triggered` |
| `failed` | Purchase failed before issuance | `txHash`, `reason` |

Amounts are base-unit USDC strings, as in the REST API.

## Cover purchase flow (#246)

1. `/cover` calls the REST purchase endpoint, the wallet signs, and the transaction is submitted. **The tx hash from that call is the source of truth.**
2. The page adds an optimistic entry, keyed by tx hash, to `usePendingPolicyStore`. The store is persisted to `localStorage`.
3. While the wallet has an unsettled entry, `usePolicyStream(address)` subscribes to `policy.<address>`. Events move the entry `submitted → accepted → active`, or roll it back to `failed`. They never move it backwards, so duplicate and out-of-order events are harmless.
4. If no event settles an entry within 90 s (`PENDING_WAIT_MS`), the REST result stands: the entry becomes `active` with `confirmedBy: "rest"`. A later `issued` event upgrades it to `confirmedBy: "realtime"`.

Edge cases:

- **Navigating away:** the entry is persisted. On return, the hook re-subscribes and the existing row updates in place. Nothing is duplicated, because rows are keyed by tx hash.
- **Multiple tabs:** a `storage` listener rehydrates the store. Adding the same tx hash twice merges into one row. `findInFlightDuplicate` blocks buying an identical policy while one is still settling.
- **Policies bought elsewhere:** an `issued` (or `accepted`) event for an unknown tx hash creates a row marked `external`.

## Clock skew (#247)

Never compute `Date.now() - event.ts`. Use:

- `normalizeServerTs(ts)` to convert server time to client time
- `serverEventAgeMs(ts)` and `isServerTsStale(ts, maxAgeMs)` for freshness decisions
- `useServerRelativeTime(ts)` or `formatServerRelativeTime(ts)` for "4 minutes ago" text. The hook re-renders only when the text changes.

The estimator (`ClockOffsetEstimator`) takes NTP-style mid-point samples from each ping/pong. It uses the median offset of the lowest-RTT samples in an 8-sample window, so a single slow or wild sample doesn't move it. `uncertaintyMs` is half the best RTT. If the wall clock and the monotonic clock drift apart by more than 2 s (sleep/resume, manual clock change), all samples are discarded. Offsets over 30 s set `skewed: true` as a diagnostic, not an error. `getClockSync()` exposes a read-only snapshot.

The estimator has no transport dependency. SSE and long-poll transports feed it with `addSample(t0, serverTs, t3)`.

## Compression and payload limits (#249)

- **`permessage-deflate`:** browsers offer it during the WebSocket handshake automatically, and script cannot change that offer. The backend should accept it with `client_no_context_takeover; server_no_context_takeover`. Non-browser WebSocket implementations (e.g. `ws`) receive `PERMESSAGE_DEFLATE_OPTIONS` as a constructor argument. If the server declines, nothing changes except the diagnostics.
- **Size guard:** `decodeFrame()` rejects frames over `MAX_MESSAGE_BYTES` (256 KiB, measured in UTF-8 bytes) **before** `JSON.parse`. Steady-state pushes are under 4 KiB. The budget is sized for the largest legitimate frame, an initial topic snapshot of up to 200 rows (about 150 KiB). If snapshots need to grow, raise the cap and the snapshot limit together.
- **Error path:** a rejected frame (`oversize`, `malformed`, `unsupported_frame`) is dropped and counted (`oversizeDrops` / `malformedDrops`). It is recorded as `lastError`, warned about in development, and passed to `client.onProtocolError` listeners. The connection stays open: closing it would only make the server resend the same frame.
- **Diagnostics:** `client.getDiagnostics()` returns:
  - `negotiatedExtensions` and `compressionActive` (from `WebSocket.extensions`)
  - `framesReceived` and `bytesReceived` (decoded bytes)
  - `wireStats`: compressed vs uncompressed bytes as reported by the server. Browsers don't expose compressed sizes to script.

## Bundle budget (#248)

- UI code must load the client through `loadRealtime()`. The dynamic import is named, so it builds to `.next/static/chunks/realtime.<hash>.js`. ESLint (`no-restricted-imports`) rejects static imports of `@/lib/realtime/client`, `@/lib/realtime/entry` and `@/lib/realtime/dev/*` outside `src/lib/realtime` and tests.
- **Budget: 8 kB gzipped** for the `realtime` chunk (`.size-limit.json`). The client, codec and policy validators measure about 3.1 kB gzipped on their own. zod is not counted, because `/cover` already loads it for form validation and webpack shares it. The remaining headroom is reserved for the SSE and long-poll transports. **Revisit this number once the transport matrix is final.** The shared-bundle budget excludes the lazy chunk, so it still measures what every visitor downloads.
- `npm run size:realtime` (`scripts/check-realtime-bundle.mjs`) runs in CI after `next build`. It fails if:
  - anything from `src/lib/realtime/dev` appears in `.next/static` (detected by the `__REFRACT_REALTIME_DEV_ONLY__` marker), or
  - the client appears in any chunk a route loads up front (per Next's build manifests).
- Gzip sizes are deterministic for a given build, so the budgets don't flake. Leave at least ~25% headroom when adjusting a limit.

## Feature flag matrix

Flags live in `public/flags.json`. **Realtime is off by default** — do not
assume it is on.

| Flag | Default | Effect |
| --- | --- | --- |
| `realtime.enabled` | `false` | Master switch for the realtime layer |
| `realtime.shadow` | `false` | Shadow mode: observe messages, do not apply |
| `realtime.topics.<topic>` | `false` | Per-topic enable |

A topic is live only when `realtime.enabled` **and** its per-topic flag are
true. Shadow mode requires `realtime.enabled` but applies nothing.

## Fallback-to-REST semantics

Realtime is **optional**. When any of the following is true, the client uses
REST only and never blocks the UI:

- the realtime feature flag for the topic is off (the default),
- capability negotiation fails or the backend does not advertise realtime,
- the connection enters `fallback` after backoff is exhausted.

Fallback is silent to the user: data still loads over REST. Realtime, when
available, only *augments* the REST snapshot via `merge.ts`.

## Cross-repo dependency: `refract-backend`

The realtime contract above must be implemented in `refract-backend`. Until
that lands, treat this document as the spec the backend is built against.
Changes to the contract require a coordinated change in both repos.

## Testing

Use the fake transport from `@/lib/realtime/dev` (tests only — never import
it from production code):

```ts
const fake = installFakeRealtime();
realtimeClient.subscribe("oracle_update", handler);
fake.current.open();
fake.current.emit("oracle_update", { severity: "triggered", value: 9 }); // typed from the contract
fake.current.drop(); // force close; advance fake timers for reconnect
afterEach(() => fake.teardown());
```

## Operational runbook

### "Data stopped updating"

1. Check the topic's flags in `public/flags.json` — is `realtime.enabled` and
   the per-topic flag on? If off, REST is the expected path; realtime is not
   the cause.
2. Inspect connection health (below). A connection stuck in `reconnecting` or
   `fallback` means updates arrive over REST only.
3. Confirm `refract-backend` is serving the realtime contract; if not, this is
   expected and not a regression.
4. If shadow mode is on, messages are observed but not applied — that is by
   design.

### Reading connection health metrics

- **state**: current state machine state (`idle`/`connecting`/`open`/
  `reconnecting`/`fallback`).
- **lastMessageAt**: timestamp of the last applied message; a stale value with
  state `open` suggests a heartbeat problem.
- **seq gap**: a jump in `seq` indicates dropped messages; `merge.ts` will
  reconcile on the next REST refresh.
- **reconnect count**: rising counts point at network or backend instability.

### Disabling a topic via flags

Set the per-topic flag (e.g. `realtime.topics.<topic>`) to `false` in
`public/flags.json`, or set `realtime.enabled` to `false` to disable the whole
layer. Consumers fall back to REST automatically.

### Running the local mock server

The mock server lets you develop against the contract before the backend
implements it. Start it locally and point the client at it; the client then
negotiates capabilities and streams messages per the contract above. See
`CONTRIBUTING.md` for the development workflow against the mock server.


# Realtime v1 transport contract

The REST API remains the initial source of truth. The backend currently has no
implemented realtime contract; it must implement this version before streaming
is enabled. An old/unsigned feed fails closed rather than updating financial UI.

## Authentication and resume

Use a TLS WebSocket at `/ws`. The client sends
`{type:"auth",version:1,challenge,credential}` first. `credential` is the latest
application authentication intent (null for anonymous public feeds); never use a
wallet signing key here. The server authenticates credentials and responds:

```json
{
  "type": "authenticated",
  "version": 1,
  "challenge": "echo-client-nonce",
  "session": "fresh-unpredictable-session-id",
  "wildcards": false,
  "topics": []
}
```

The session must be unique to this authenticated connection, at least 16
characters. `topics` is the complete post-resume interest set, not a delta. An
invalid handshake is counted; an unauthenticated socket times out after 10s.
No topic mutations precede authentication. A credential change opens a fresh
connection; a newer credential supersedes an earlier one.

Outbound frames are `{type:"subscribe",topic}` and
`{type:"unsubscribe",topic}`. These operations MUST be idempotent. On each
handshake the client reconciles the server's resume set against its desired
registry. Surviving queued mutations preserve their first intent order. Unknown resumed
interests are removed after queued work, before any remaining additions. Repeated toggles collapse to the final state; no ordering is
promised for intermediate intents which cancel each other. Shared registrations
retain one wire interest. There is one reconciliation owner, so resync never
independently re-subscribes topics. A transport failure stops the flush and retries
only after reconnect/authentication, using the next authoritative resume set.

The registry is the outbound desired-state queue, bounded to 256 distinct
patterns (configurable at construction). Overflow of the desired registry rejects a new subscription with a clear
exception. The ordering queue is separately bounded to the same capacity; if it
overflows, it is compacted and the complete desired registry is reconciled (so no
final intent is lost, though intermediate ordering is no longer guaranteed). Both
cases increment `diagnostics.overflow`; existing interests are retained. Removed offline interests occupy no queue space. Reconciliation
removes any no-longer-desired resumed topics. `disconnect()` and wallet logout
clear handlers, desired state, credentials, timers and resume state. Old release
callbacks cannot affect a subsequent session. Nothing persists across reloads.

## Ingress authentication and threat model

This implementation uses the authenticated-session option, not application-layer
signatures. TLS authenticates the configured endpoint and protects bytes in
transit. The fresh challenge authenticates the handshake's connection binding;
every event carries that session binding, a strictly increasing safe-integer
`sequence`, and a millisecond Unix `timestamp`. Example:

```json
{
  "session": "fresh-unpredictable-session-id",
  "sequence": 1,
  "timestamp": 1790000000000,
  "topic": "oracle_update",
  "payload": { "readings": [] }
}
```

All topics, including oracle and claim events, pass the same synchronous ingress
filter before payload dispatch. Wrong/missing session bindings, duplicate or
out-of-order sequence numbers, and timestamps outside ±60 seconds are rejected.
No unsigned legacy envelopes are accepted. Sequence gaps are permitted; inbound
buffering is outside this contract. Payloads remain `unknown`; consumers must
validate topic-specific payload schemas before rendering.

Production requires `wss:` and exact page scheme/host/port matching, or an explicit
build-time `NEXT_PUBLIC_REALTIME_ALLOWED_ORIGINS` list of WebSocket origins
(comma separated, including scheme and nondefault ports). URL credentials,
queries, and fragments are rejected. Development permits `ws:` only when both
page and endpoint are loopback hosts. No runtime flag disables ingress checks,
even in mock mode. Configure the backend to validate browser Origin headers,
authenticate cookies/tokens and authorize every topic; browser code cannot enforce
those server responsibilities.

This protects against accidentally configured untrusted endpoints, network
injection under TLS, unsigned envelopes, stale cross-session events and replay
within one connection. The binding is NOT a cryptographic signature and provides
no independent protection against a compromised trusted backend, TLS terminator,
XSS, compromised browser, or attacker who controls allowed-origin configuration.
Server-side signing/key management and wallet transaction signing are out of
scope. If independently signed data is required, the backend must first publish
an asymmetric signing and rotation contract; do not ship a shared MAC secret in
the frontend.

`client.diagnostics` exposes rejection, overflow and transport counters plus the
last 20 reason-only breadcrumbs. No payload, credential or session is logged;
failures do not trigger user-facing toasts. Consumers may export these counters
to existing telemetry. REST fallback continues during failures.

## Topic grammar and delivery

Segments contain ASCII letters, digits, `_` or `-`, separated by `.`. A pattern
is at most 200 characters. `*` matches exactly one segment. Terminal `**` matches
zero or more segments. Examples: `pool.abc.*` matches `pool.abc.price` but not
`pool.abc.claim.settled`; `pool.abc.**` matches both and also `pool.abc`.
`pool..price`, `po*`, and `pool.**.price` are invalid and throw at subscribe time.
The existing flat names `oracle_update`, `pool_update`, `claim_update` remain
valid. Inbound topics must be concrete.

When the server advertises `wildcards:true`, patterns are sent directly.
Otherwise the client enumerates its concrete `topics` catalog (defaults in
`topics.ts`) and deduplicates the resulting wire interests. Configure a complete
catalog for per-pool/per-policy variants; unknown future topics cannot be
invented client-side and require catalog refresh or server wildcard capability.
Each registration receives an event once even if several wire interests overlap.
Two separate registrations, including exact and wildcard registrations using the
same callback function, each receive one call. Patterns compile once; dispatch
is O(registrations × segments), with 256 distinct patterns maximum. Run
`npx vitest run --config vitest.config.mts src/lib/realtime/topics.benchmark.test.ts` to measure that bound.

## Routes

`src/app/realtime-topics.ts` declares public route costs. `/` owns oracle, pool
and claim topics; `/cover` owns oracle and pool; `/provide` owns pool and claims.
Nested routes inherit their closest mapped segment. Unmapped routes release
route-owned interests while hook-owned registrations continue independently.

`RealtimeRouteProvider` resolves pathname changes without blocking first paint,
fetches a bounded REST snapshot before acquiring new interests, and batches
navigation over 40ms. Shared topics retain their registration across navigation.
Stale asynchronous snapshot completions cannot subscribe a previous route.
Snapshot failures retain normal REST fallback and permit streaming recovery.
`useRealtimeTopic` allows additional hook-owned interests and typed unknown
payloads. Set `prefetchOnIntent` on the provider to warm subscriptions on same-origin link
hover/focus without rendering data. Prefetch snapshots precede subscriptions;
interests are shared through the same registry and expire after five seconds.
Repeated intents for the same route topic set are deduplicated, and teardown
cancels in-flight prefetch. Prefetch is disabled by default.

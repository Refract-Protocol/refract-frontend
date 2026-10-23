# Realtime transport contract

The backend streaming endpoint remains a separate integration. REST reads are
still authoritative. Enable `realtime-oracle` / `realtime-pool` through the existing
feature flag service to opt in. The cover route derives the oracle series ID from
the selected coverage type. The provide hook targets `<network>:protocol`, the
single pool currently exposed by the app. Changing the hook's pool ID changes its
subscription. Payloads invalidate REST reads in fixed 100ms windows; no merge or
render contract is changed.

## Interests

Subscriptions are descriptors, for example:

```json
{
  "action": "subscribe",
  "topic": "oracle_update",
  "interest": { "entityIds": ["0"], "minVersion": 12, "fields": ["value"] }
}
```

`unsubscribe` uses the same descriptor. IDs and fields are trimmed, deduplicated,
and sorted; equivalent descriptors share one wire subscription and are reference
counted. The final listener releases the subscription. Reconnect replays active
descriptors. Hooks debounce acquisition by 150ms and release old interest
immediately. No IDs/cursors means an error unless `broad:true` is explicit; a field
projection or a zero cursor alone cannot authorize broad traffic. Floors are inclusive, finite,
nonnegative numbers. Timestamp units are Unix milliseconds. Entity IDs are strings.

Server filtering/projection is advisory. Each incoming envelope is validated and
matched against entity IDs and floors before scheduling and again before delivery.
Missing filter metadata fails the match. Projection does not change dispatch.
Notifications/history persistence is untouched.

## Scheduling

| Critical                                                          | Bulk                                           |
| ----------------------------------------------------------------- | ---------------------------------------------- |
| `claim_settlement`, `transaction_confirmation`, `auth`, `control` | `oracle_update`, `pool_stats`, `activity_feed` |

Unknown topics are rejected. FIFO queues preserve each topic's order. Up to eight
critical deliveries precede one waiting bulk delivery, including across drain
budgets. Each drain handles at most 64 messages or 4ms, then yields to a timer so
network and rendering tasks can run. Initial dispatch also yields to a timer so separate WebSocket message tasks can
build a queue instead of draining FIFO at each microtask checkpoint. With only
one active topic and no backlog, dispatch is synchronous, as before.

Each class holds at most 2048 messages; overflow rejects the newest message and
increments `client.scheduler.metrics.droppedCritical` or `droppedBulk`. Applications
must retain REST reconciliation; a bounded best-effort stream cannot guarantee
lossless delivery under unlimited input. `worstCriticalLatencyMs` records the
maximum enqueue-to-dispatch wait and logs increases through `console.debug`.
A critical message with no earlier critical backlog waits for at most the current
cooperative drain plus one fairness slot. Synchronous subscriber work, browser
background throttling, and critical overload prevent an absolute wall-clock SLA.
The synthetic burst test checks a 50ms foreground latency budget behind 2000 bulk
messages and reports the observed maximum.

## Codecs

The handshake advertises, in order, `refract.json.v1`, `refract.tuple.v1`. Selection
is fixed for that connection. Empty or unsupported selection falls back to JSON.
JSON uses unchanged `JSON.stringify` / `JSON.parse` text serialization.

The optional compact codec has no dependency or bundle-size overhead beyond its
small adapter. A binary frame is UTF-8 JSON encoding of a five-slot tuple:

```json
["oracle_update", { "value": 0.99 }, "USDC", 20, 123]
```

Slots are topic, payload, entity ID, version, timestamp; absent metadata is `null`.
It saves repeated envelope keys rather than compressing arbitrary payload values.
Outbound subscription control frames use the same descriptor object encoded as
UTF-8 binary JSON under the tuple protocol. Both decoders produce the same
validated `Message`; subscribers and any inspector receive readable JS payloads.
Malformed frames are ignored. The backend must implement exactly this negotiated
format before selecting it. Unknown selection only enables the JSON parser; it
does not attempt to guess binary formats.

## Endpoints and health

Without an override, the API base URL derives the `/ws` endpoint. Configure ordered
network-specific endpoints using `NEXT_PUBLIC_REALTIME_ENDPOINTS`, for example:

```json
{
  "testnet": ["wss://primary.example/ws", "wss://fallback.example/ws"],
  "mainnet": ["wss://main.example/ws"]
}
```

Invalid configuration fails loudly. Each client owns a fresh selector for its
configured network. Changing `NEXT_PUBLIC_STELLAR_NETWORK` rebuilds/reinitializes
the singleton and resets health; never reuse a manually constructed client across
networks. Health is neither persisted nor shared across client instances.

Failed or silent connections increase a failure score; 10 seconds without a valid
first message closes the connection. The next backoff attempt selects the lowest
score, preserving configured order on ties. Failures dominate the score, followed
by success age and time to first valid message. A valid first message resets the
endpoint's failures and reconnect backoff. Exponential reconnect delays are capped
at 30 seconds. Expose `selectedEndpoint` and `endpoints.health` for observability.

After 60 seconds on a fallback, its socket closes and reconnect tries the preferred
endpoint. This runs automatically without user action but occupies the same socket
slot; there are never simultaneous endpoint connections. If the preferred endpoint
still fails, health selection returns to the fallback. Subscribers replay after the
handshake. A preferred retry may briefly interrupt a healthy fallback; REST state
remains available throughout.

## Verification

Run the focused suite with the populated config (the repository also contains an
empty `vitest.config.ts`):

```sh
npx vitest run --config vitest.config.mts src/lib/realtime/realtime.test.ts src/hooks/useRealtimeTopic.test.ts --reporter=verbose --silent=false
```

The mock socket tests exercise refusal, silent handshake, fallback recovery,
preferred retry, all negotiation outcomes, replay, descriptor reference counts,
and defensive filtering. The scheduler tests include 2000-event burst latency,
FIFO order, fairness, bounded queues, clear, and synchronous single-topic dispatch.
Codec tests report representative JSON/tuple bytes. Filtering evidence uses three
frames: stale A, unrelated B, current A; only current A reaches either matching
listener (one of three frames, versus three for a broad subscription).

### Local evidence (2026-10-22)

- Focused realtime suite: **21 passed**; existing pool fallback suite: **4 passed**.
- Synthetic 2000-event bulk burst: **0.169ms** maximum critical queue latency in
  the sampled foreground run (50ms assertion budget).
- Representative oracle envelope: **97 JSON bytes / 46 tuple bytes** (53% smaller).
- Advisory filtering: **1 of 3 frames delivered** to each matching listener;
  stale versions and unrelated entity IDs are rejected locally.
- Scoped TypeScript check passes. Scoped ESLint passes with the upstream malformed
  `no-restricted-syntax` selector disabled.
- Unmodified upstream `8260266` independently reproduces **62 failing tests**, the
  cover-page JSX parse errors, and ESLint's invalid `Literal[value=1e7]` selector.
  The full suite on this branch has the same 62 failures. The default test config
  is empty; the explicit `.mts` config is required. Clean `npm ci` also fails on
  the upstream dependency/lockfile state. Local installation used
  `--legacy-peer-deps --package-lock=false`; no dependency files are changed.

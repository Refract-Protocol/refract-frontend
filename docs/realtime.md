# Realtime layer

`src/lib/realtime/` delivers push updates (oracle readings, claim settlements,
pool stats) to React components. Realtime is **best-effort**: every consumer
keeps a REST fetch as its source of truth and uses realtime to stay fresh.

```
transport (WS │ SSE │ long-poll)
   → FrameDecoder      main thread or Web Worker, order preserved     (#242)
   → contract check    zod schemas in topics.ts
   → DedupeCache       drop repeated event ids                        (#244)
   → resume cursor     per-topic seq, used on reconnect
   → handlers          useRealtimeTopic(topic, { onEvent, onGap })
```

| File | Role |
| --- | --- |
| `topics.ts` | Message contract: event/control schemas, cursor encoding |
| `decode.ts` | Pure `decodeFrame()`: parse + validate + normalize, typed failures |
| `frameDecoder.ts`, `decoder.worker.ts` | Worker offload with main-thread fallback |
| `dedupe.ts` | Per-topic LRU + TTL window of seen event ids |
| `transports/*` | `WebSocketTransport`, `SseTransport`, `LongPollTransport` |
| `capabilities.ts` | Capability detection and the default transport tiers |
| `client.ts` | `RealtimeClient`: negotiation, reconnect, resume, dedupe, fan-out |
| `testing/mockServer.ts` | Scenario-driven mock backend + in-memory WebSocket |
| `src/hooks/useRealtimeTopic.ts` | React hook (fan-out boundary) |
| `src/app/dev/realtime/page.tsx` | Dev panel: status, transport, counters, live events |

## Message contract

Server → client data event:

```json
{ "topic": "oracle_update", "id": "evt_01H…", "seq": 42, "payload": { … } }
```

- `id`: stable, unique per event. Used for de-duplication.
- `seq`: monotonic per topic. Used as the resume cursor and for gap detection.
- An event **without `id`** is still delivered, but it is not de-duplicated and
  it bumps the `missingId` counter. An event without `seq` doesn't move the cursor.

Server → client control frames:

| Frame | Meaning |
| --- | --- |
| `{ "type": "subscribed", "topics": [...], "gap"?: [...] }` | Subscribe acknowledged. `gap` lists topics whose cursor fell outside the server's replay window |
| `{ "type": "error", "code": "auth_failed" }` | Auth rejected. The client stops reconnecting |
| `{ "type": "ping" }` | Heartbeat. The client replies with `{ "type": "pong" }`. Send at least every 30s |

Client → server (WebSocket): `{ "type": "subscribe", "topics": [...], "cursors": { "oracle_update": 41 } }`,
`{ "type": "unsubscribe", "topics": [...] }`. On reconnect the server replays events with `seq > cursor`.

### Long-poll endpoint (#245)

```
GET {API}/realtime/poll?topics=oracle_update,pool_stats&after=oracle_update:41,pool_stats:7
```

- **200** `{ "events": [...], "timeoutMs": 25000, "gap"?: [...], "cursors"?: {...} }`
- **204**: no events before the hold timeout. Poll again.
- **401/403**: auth rejected. **404/405/501**: endpoint isn't offered, so the client falls back to the next tier.
- **429/5xx**: retry later. `Retry-After` is honoured.

The server holds the request until it has events or `timeoutMs` passes. If a
topic is sent without a cursor, the server answers right away with
`cursors: { topic: currentSeq }`. That reply is the handshake and the
subscribe acknowledgement.

Requests use the same API base URL as REST, with `credentials: "include"`, so
whatever auth the API or proxy applies to REST applies here too.

SSE uses `GET {API}/realtime/sse?topics=…&after=…`. Each `message` event
carries one frame in the format above.

## Transport negotiation

The client tries **WebSocket → SSE → long-poll** and then falls back to **REST polling**:

1. Tiers the browser can't run (no `WebSocket`, no `EventSource`, no `fetch`) are skipped.
2. A tier that fails to open twice in a row (and has never opened) is marked
   failed, and the client tries the next tier straight away.
3. Once a tier has opened, later drops reconnect on that same tier with
   exponential backoff (1s → 30s).
4. If nothing works, the status becomes `degraded` (`no_transport`). Callers keep
   polling REST, and the client tries the full tier list again after 60s.

`client.getStats().transport` and `.negotiation` record which tier won and why.

## Failure handling

| Situation | Client behaviour |
| --- | --- |
| Abrupt close (1006/1011/1001/1012) | Reconnect with backoff and resubscribe with cursors. Replayed events are de-duplicated |
| Half-open socket (no frames or pings for 45s) | Treat as dead, reconnect (`idleTimeouts`) |
| Subscribe not acknowledged in 10s | Resend up to 3 times, then go `degraded` (`subscribe_timeout`) and retry later |
| Auth rejected (`error` frame, close 4401/4403, HTTP 401/403) | Go `degraded` (`auth`) with **no retry loop** until `resetSession()` |
| Resume cursor outside the replay window | `onGap({ reason: "resume" })`. Refetch REST |
| `seq` jumps mid-stream | `onGap({ reason: "sequence" })`. Refetch REST |
| Malformed or oversized frame | Dropped and counted in `decodeErrors`. The connection stays up |

`realtimeClient.resetSession()` runs when the wallet account or network changes
(see `WalletProvider`). It clears the dedupe ids and cursors, which belong to
the previous identity, and reconnects.

## De-duplication (#244)

`DedupeCache` keeps a per-topic window of recently seen ids:

- **Size** (default 2,000 per topic): peak events/sec × the longest replay window.
  The default covers about 50/s over 40s.
- **TTL** (default 5 min): after this, an id can be processed again.
- It lives in memory only, so a page reload starts clean and never hides
  events that are legitimately sent again.

Counters (`duplicatesDropped`, `missingId`, per topic) are available from
`client.getStats().dedupe`, in the dev panel, and as `window.__refractRealtime`
outside production.

## Off-main-thread decoding (#242)

`FrameDecoder` decides per frame where to decode:

- Frames under 512 chars always decode on the main thread. Copying them to a
  worker costs more than parsing them.
- Frames of 16 KB or more always go to the worker.
- Frames in between go to the worker only while the rate is at least 50 frames/sec.
- Results are delivered **in arrival order**, whichever path decoded them.
- If the worker can't start (no `Worker`, CSP), throws, or doesn't answer within
  2s, the decoder switches to the main thread **for the rest of the session**
  and re-decodes any frames that were in flight.

The worker (`decoder.worker.ts`) is stateless and only calls the same pure
`decodeFrame()`. A parity test runs every fixture, including invalid frames,
through both paths. Next.js (webpack 5) bundles the
`new Worker(new URL("./decoder.worker.ts", import.meta.url))` pattern natively,
so `next.config.js` needs no change.

### Measurements

`npm run bench:realtime -- --seconds 3` (Node 24, Codespaces 2-vCPU). Frames arrive in 50 bursts/sec:

| Profile | Path | Main-thread busy % | p95 burst (ms) |
| --- | --- | --- | --- |
| oracle tick, ~0.3 KB @ 500/s | main | 1.6 | 0.202 |
| | worker | 1.7 | 0.087 |
| oracle batch, ~8 KB @ 200/s | main | 1.9 | 0.261 |
| | worker | 2.4 | 0.070 |
| pool snapshot, ~50 KB @ 40/s | main | 1.7 | 0.387 |
| | worker | 2.5 | 0.059 |

With the worker, the longest single main-thread block is **2–6.5× shorter**.
That block is what competes with a frame paint. **Total** main-thread work stays
about the same, or slightly higher, because results are structured-cloned back.
This is why small frames stay on the main thread and the thresholds are
tunable. Browsers clone faster than Node `worker_threads`, but the trade-off
works the same way. Re-run the bench on the target hardware before changing the
thresholds.

## Testing

| Command | What it runs |
| --- | --- |
| `npm test` | All unit tests, including `src/lib/realtime/__tests__` |
| `npm run test:chaos` | Fault-injection scenarios plus the WS/long-poll parity contract test. Fake timers, deterministic |
| `npm run mock:realtime -- --scenario flaky --rate 250` | Local mock backend on `:4010` |
| `npm run test:chaos:e2e` | Playwright smoke against the mock backend and `/dev/realtime` |

Mock-server presets: `none`, `flaky`, `half-open`, `slow`, `drop-subscribe`,
`auth-reject`, `at-least-once`. Tests describe faults declaratively:

```ts
const server = new MockRealtimeServer({
  connections: { 2: { ignoreSubscribe: true } }, // backend lost state after restart
  resumeOverlap: 2,                              // at-least-once replay on resume
});
```

To watch the client in a browser, start the mock backend, run the app with
`NEXT_PUBLIC_ENABLE_UI_GALLERY=true`, and open
`/dev/realtime?api=http://127.0.0.1:4010/api/v1`.

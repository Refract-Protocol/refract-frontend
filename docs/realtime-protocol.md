# Realtime protocol (v1)

WebSocket at `ws(s)://<api-host>/ws` (derived from `NEXT_PUBLIC_API_URL` by `deriveRealtimeUrl`). Types live in `src/lib/realtime/protocol.ts`; the transport is `src/lib/realtime/client.ts`; the dev/CI server is `scripts/mock-realtime-server.mjs`.

## Server → client frame

```json
{ "v": 1, "topic": "oracle", "seq": 12, "ts": 1700000012000, "payload": {} }
```

- `topic`: `oracle` | `claims` | `pool` | `notifications`. `seq` is per-topic and monotonic; `ts` is epoch ms and is the ordering/version key for the merge layer.
- Frames with an unknown `topic` or `v`, or that fail validation, are ignored and logged (reason only).
- Payloads: `oracle {id, price, updatedAt}`, `claims {id, policyId, status, amount, updatedAt}`, `pool {id, tvl, utilization, updatedAt}`, `notifications {id, kind, message, createdAt}`.
- `{"op":"pong"}` answers a client ping.

## Client → server

`{"op":"subscribe","topic":"oracle","cursor":12}` (cursor optional; the server replays frames with `seq > cursor`), `{"op":"unsubscribe","topic":"oracle"}`, `{"op":"ping"}`.

## Close codes

`4401` auth rejected — the client does not reconnect. Any other close triggers capped, jittered exponential reconnect (1s base, 30s cap) that re-subscribes with each topic's last `seq`.

## Merge rules

`src/lib/realtime/merge.ts` folds events into a REST snapshot: idempotent, version (`ts`) ordered, stale events dropped, unknown ids inserted, removals tombstoned.

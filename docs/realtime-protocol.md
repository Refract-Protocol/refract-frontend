# Realtime protocol

WebSocket at `ws(s)://<api-host>/ws` (derived from `NEXT_PUBLIC_API_URL` by `deriveRealtimeUrl`). Types live in `src/lib/realtime/protocol.ts`; the transport is `src/lib/realtime/client.ts`; the dev/CI server is `scripts/mock-realtime-server.mjs`.

The frontend connects to the API origin's `/ws` endpoint. WebSocket frames are JSON. A topic event has the shape `{ "topic": "claims.settlement", "payload": { ... } }`. Realtime delivery is best effort: REST remains authoritative for initial state and paginated history, and clients show REST data while the connection is stale.

## Server → client frame

```json
{ "v": 1, "topic": "oracle", "seq": 12, "ts": 1700000012000, "payload": {} }
```

- `topic`: `oracle` | `claims` | `pool` | `notifications`. `seq` is per-topic and monotonic; `ts` is epoch ms and is the ordering/version key for the merge layer.
- Frames with an unknown `topic` or `v`, or that fail validation, are ignored and logged (reason only).
- Payloads: `oracle {id, price, updatedAt}`, `claims {id, policyId, status, amount, updatedAt}`, `pool {id, tvl, utilization, updatedAt}`, `notifications {id, kind, message, createdAt}`.
- `{"op":"pong"}` answers a client ping.

## Connection and authentication

Public subscriptions can be used without a wallet. Before sending any wallet-scoped subscription, the client requests a short-lived credential with `POST /api/v1/realtime/token` and `{ "wallet": "<public address>" }`. The response is `{ "token": "<opaque bearer token>", "expiresAt": 1792600000 }`, where `expiresAt` is Unix seconds (Unix milliseconds are also accepted). The client sends `{ "type": "authenticate", "wallet": "<public address>", "token": "<opaque bearer token>" }` as the first authenticated WebSocket frame. Tokens are never placed in URLs or logged.

The server replies `{ "type": "authenticated" }`, then the client sends one `{ "type": "subscribe", "topic": "..." }` frame for each active topic. On token refresh, the client sends another `authenticate` frame with `refresh: true`; existing subscriptions remain active. On reconnect, the client obtains a fresh token, authenticates, and sends each active subscription once. Identity changes close the old socket and repeat the handshake for the new wallet.

The server can send `{ "type": "token_expiring" }` to request an early refresh. Authentication errors use `{ "type": "auth_error", "status": 401|403, "code": "..." }` or an error frame with the same status. WebSocket close codes 4401 and 4403 also mean authentication failed. The client stops retries for those wallet-scoped topics and reports a degraded state; network failures continue to retry with backoff. Error reporting must omit tokens and full authentication frames.

## Client → server

`{"op":"subscribe","topic":"oracle","cursor":12}` (cursor optional; the server replays frames with `seq > cursor`), `{"op":"unsubscribe","topic":"oracle"}`, `{"op":"ping"}`.

## Close codes

`4401` auth rejected — the client does not reconnect. Any other close triggers capped, jittered exponential reconnect (1s base, 30s cap) that re-subscribes with each topic's last `seq`.

## Topics

`oracle_update` carries an `OracleReading` directly or under `payload.reading`.

`claims.settlement` carries a normalized claim directly or under `payload.claim`. Claim rows contain `claimId` (preferred stable ID), `policyId`, `holder`, `coverageType`, `triggered`, `payout`, `reason`, `processedAt`, optional `settlementTxHash`, and optional `status`. `dedupKey` may be supplied at the envelope or row level. `processedAt` is Unix seconds. A terminal status is `settled`, `paid`, `rejected`, `failed`, or `cancelled`. Clients upsert by `dedupKey`, `claimId`, `id`, settlement transaction hash, then policy ID. A terminal claim cannot regress from an older replay. Pushed rows are held separately from REST cursors and merged with every REST page.

`notifications` carries `{ "notification": { "id", "type", "title", "message", "timestamp", "severity", "href?" } }`, or the notification directly. IDs are stable across replay and REST refetch. Timestamps are Unix milliseconds or ISO-compatible numeric timestamps in milliseconds. The frontend's notification read mutation is `POST /api/v1/notifications/{id}/read`.

`transactions.confirmation` carries `{ "event": { "correlationId", "outcome", "authoritative?", "reason?" } }`, or the event directly. `outcome` is `confirmed`, `amended`, or `rejected`. The client places the correlation ID in the `Idempotency-Key` header for the original buy/provide/withdraw request. A rejected event rolls back the optimistic transaction entry and displays a dismissible notice. Unresolved actions are checked with `POST /api/v1/transactions/verify` and `{ "correlationId" }`; the response status is `confirmed`, `rejected`, or `pending`.

## Merge rules

`src/lib/realtime/merge.ts` folds events into a REST snapshot: idempotent, version (`ts`) ordered, stale events dropped, unknown ids inserted, removals tombstoned.

## Feature flags

Realtime remains disabled by default. `realtime-oracle`, `realtime-claims-settlement`, `realtime-notifications`, and `realtime-transactions` independently enable their corresponding topic consumers in `public/flags.json`.

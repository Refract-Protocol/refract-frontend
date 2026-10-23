# Refract realtime protocol v1

This is the frontend/backend contract for realtime updates. REST remains the source for initial state and full resynchronization. The v1 endpoint is `GET /api/v1/realtime`; clients request WebSocket with `Upgrade: websocket`. SSE may later expose the same envelopes, cursors, and auth rules.

## Transport decision

All four topics use one WebSocket. Claims and notifications need an authenticated, account-scoped subscription; bidirectional WebSocket frames support that handshake and dynamic subscriptions without reconnecting. Oracle readings and pool stats are broadcast and could use SSE, but sharing the connection avoids another transport, heartbeat, cursor store, and retry loop. If an SSE endpoint is added, it must preserve these frames and use the event `id` as `Last-Event-ID`.

| Topic               | Type                        | Delivery                                         | Deduplication key                         |
| ------------------- | --------------------------- | ------------------------------------------------ | ----------------------------------------- |
| `oracle.readings`   | `oracle.reading.updated`    | Ordered, best effort; REST refresh after any gap | `id` (stable per source observation)      |
| `claims.settlement` | `claims.settlement.updated` | Ordered, at least once with cursor replay        | `id` (stable per claim status transition) |
| `pool.stats`        | `pool.stats.updated`        | Ordered, best effort; latest snapshot wins       | `id` (stable snapshot ID)                 |
| `notifications`     | `notifications.created`     | Ordered, at least once with cursor replay        | `id` (same value across retries)          |

`seq` increases within one topic and deployment. Consumers discard duplicate `id` values. A frame with `seq` below the last applied sequence is out of order and ignored; a gap on a best-effort topic triggers a REST refresh. At-least-once topics request replay. Delivery order across topics is unspecified.

## Common envelope and compatibility

Every server frame carries `v`, `topic`, `type`, `id`, `seq`, `ts`, and object `payload`. `v` versions the envelope and payload together. Additive payload fields are allowed in v1 and clients ignore them. Breaking changes require v2. Clients ignore and log unknown topics, types, and versions; they never throw into the UI.

`id` is the idempotency key. `ts` is an RFC 3339 UTC server timestamp for display and diagnostics only; clients do not use it for ordering because clocks can skew. UTF-8 frames are at most 64 KiB. The server closes oversized input with WebSocket code 1009. Schemas are in [`realtime.schema.json`](./realtime.schema.json); CI validates every named example fence.

```json realtime-example:oracle.reading.updated
{
  "v": 1,
  "topic": "oracle.readings",
  "type": "oracle.reading.updated",
  "id": "weather-4-2026-10-21T19:00:00Z",
  "seq": 4102,
  "ts": "2026-10-21T19:00:01Z",
  "payload": {
    "coverageType": 4,
    "severity": "medium",
    "value": 47.5,
    "observedAt": "2026-10-21T19:00:00Z"
  }
}
```

```json realtime-example:claims.settlement.updated
{
  "v": 1,
  "topic": "claims.settlement",
  "type": "claims.settlement.updated",
  "id": "claim_73:paid",
  "seq": 992,
  "ts": "2026-10-21T19:01:12Z",
  "payload": {
    "claimId": "claim_73",
    "policyId": "policy_19",
    "status": "paid",
    "txHash": "4da51c"
  }
}
```

```json realtime-example:pool.stats.updated
{
  "v": 1,
  "topic": "pool.stats",
  "type": "pool.stats.updated",
  "id": "pool:ledger:814220",
  "seq": 814220,
  "ts": "2026-10-21T19:02:00Z",
  "payload": {
    "totalUsdc": "250000000000",
    "lockedUsdc": "62500000000",
    "utilizationBps": 2500,
    "apyBps": 840
  }
}
```

```json realtime-example:notifications.created
{
  "v": 1,
  "topic": "notifications",
  "type": "notifications.created",
  "id": "notification_984",
  "seq": 214,
  "ts": "2026-10-21T19:03:00Z",
  "payload": {
    "notificationId": "notification_984",
    "account": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    "kind": "claim_paid",
    "title": "Claim paid",
    "body": "Your payout has settled."
  }
}
```

## Authentication and subscriptions

After opening, the client sends `auth.challenge.request` with its public key. The server returns a short-lived SEP-10 challenge transaction. The client signs it through the active wallet and sends `auth.challenge.submit` with the signed XDR. The server responds with `auth.ok` containing an opaque connection-bound token and expiry, or a `system.error`. Tokens never appear in URLs. Anonymous connections may subscribe only to `oracle.readings` and `pool.stats`; `claims.settlement` and `notifications` require authentication and are restricted to the authenticated account.

The client sends `subscribe` with `topics` and an optional `cursor` object mapping each topic to its last applied `seq`. Client control frames use the common envelope and a unique client-generated `id`; their payloads carry these fields. The server acknowledges with `subscribed`, including accepted and rejected topics.

## Resume and resynchronization

The server retains at least 15 minutes of replay for claims and notifications. On reconnect, the client supplies each last applied sequence. The server replays retained messages in order, including duplicates at the cursor boundary. If a cursor is expired, unknown, ahead of the server, or from an earlier deployment, the server sends `system.error` code `RESYNC_REQUIRED`. The client clears that cursor, fetches REST, and subscribes again from the current head.

Oracle and pool updates do not require replay because each update supersedes earlier state. On reconnect or a sequence gap the client fetches REST, records the announced current sequence, and resumes.

## Heartbeats, errors, and backpressure

The server sends a heartbeat every 25 seconds. A client receiving no frame for 60 seconds closes and reconnects with jittered exponential backoff.

```json realtime-example:system.heartbeat
{
  "v": 1,
  "topic": "system",
  "type": "system.heartbeat",
  "id": "heartbeat:814221",
  "seq": 814221,
  "ts": "2026-10-21T19:03:25Z",
  "payload": { "intervalMs": 25000 }
}
```

Errors are connection-scoped unless their payload names a topic. A recoverable rate limit keeps the connection open and provides `retryAfterMs`; authentication failures and malformed input may close it.

```json realtime-example:system.error
{
  "v": 1,
  "topic": "system",
  "type": "system.error",
  "id": "error:rate:88",
  "seq": 88,
  "ts": "2026-10-21T19:03:26Z",
  "payload": {
    "code": "RATE_LIMITED",
    "message": "Subscription update rate exceeded",
    "recoverable": true,
    "retryAfterMs": 5000
  }
}
```

Clients may change subscriptions at most five times per 10 seconds and send at most 20 control frames per minute. The server coalesces queued oracle and pool frames to the newest snapshot. It never silently drops claims or notifications: when a connection cannot drain 256 queued frames or 1 MiB, it sends `RESYNC_REQUIRED` when possible and closes with code 1013. Clients reconnect after the supplied delay and follow the resume rules above.

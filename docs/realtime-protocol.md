# Realtime protocol

This document describes the wire format used by the realtime transports in
`src/lib/realtime/transports/` and the mappers in `src/lib/realtime/mappers/index.ts`.
The machine-readable contract is [`docs/realtime.schema.json`](./realtime.schema.json);
where this prose and the schema disagree, the schema wins.

## Envelope

Every message is a flat JSON object. There is no nested `{ type, payload }` wrapper —
the routing fields (`v`, `topic`, `type`, `id`, `seq`, `ts`) sit alongside `payload` at
the top level.

| Field     | Type    | Required | Notes                                                        |
| --------- | ------- | -------- | ------------------------------------------------------------ |
| `v`       | integer | yes      | Protocol version. Always `1`.                                |
| `topic`   | string  | yes      | Subscription topic, e.g. `oracle.readings`.                  |
| `type`    | string  | yes      | Message type, e.g. `oracle.reading.updated`.                 |
| `id`      | string  | yes      | Non-empty message identifier.                                |
| `seq`     | integer | yes      | Monotonic sequence number, `>= 0`.                           |
| `ts`      | string  | yes      | ISO-8601 date-time of when the message was produced.         |
| `payload` | object  | yes      | Type-specific body (see below).                              |

Additional top-level properties are permitted (`additionalProperties: true`).

## Message types

### `oracle.reading.updated`

Topic: `oracle.readings`

```json
{
  "v": 1,
  "topic": "oracle.readings",
  "type": "oracle.reading.updated",
  "id": "msg_01H...",
  "seq": 42,
  "ts": "2024-05-01T12:00:00Z",
  "payload": {
    "coverageType": 1,
    "severity": "medium",
    "value": 0.87,
    "observedAt": "2024-05-01T11:59:58Z"
  }
}
```

`payload` requires `coverageType` (integer), `severity`
(`low` | `medium` | `high` | `triggered`), `value` (number), and `observedAt`
(date-time).

### `claims.settlement.updated`

Topic: `claims.settlement`

```json
{
  "v": 1,
  "topic": "claims.settlement",
  "type": "claims.settlement.updated",
  "id": "msg_01H...",
  "seq": 43,
  "ts": "2024-05-01T12:00:05Z",
  "payload": {
    "claimId": "claim_123",
    "policyId": "policy_456",
    "status": "approved",
    "txHash": null
  }
}
```

`payload` requires `claimId`, `policyId`, `status`
(`pending` | `approved` | `paid` | `rejected`), and `txHash` (string or `null`).

### `pool.stats.updated`

Topic: `pool.stats`

```json
{
  "v": 1,
  "topic": "pool.stats",
  "type": "pool.stats.updated",
  "id": "msg_01H...",
  "seq": 44,
  "ts": "2024-05-01T12:00:10Z",
  "payload": {
    "totalUsdc": "1000000",
    "lockedUsdc": "250000",
    "utilizationBps": 2500,
    "apyBps": 640
  }
}
```

`payload` requires `totalUsdc` and `lockedUsdc` (decimal strings matching
`^[0-9]+$`), `utilizationBps` (integer `0..10000`), and `apyBps` (integer `>= 0`).

### `notifications.created`

Topic: `notifications`

```json
{
  "v": 1,
  "topic": "notifications",
  "type": "notifications.created",
  "id": "msg_01H...",
  "seq": 45,
  "ts": "2024-05-01T12:00:15Z",
  "payload": {
    "notificationId": "ntf_789",
    "account": "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV",
    "kind": "claim",
    "title": "Claim approved",
    "body": "Your claim was approved."
  }
}
```

`payload` requires `notificationId`, `account` (Stellar public key matching
`^G[A-Z2-7]{55}$`), `kind`, and `title`; `body` is optional.

### `system.heartbeat`

Topic: `system`

```json
{
  "v": 1,
  "topic": "system",
  "type": "system.heartbeat",
  "id": "msg_01H...",
  "seq": 46,
  "ts": "2024-05-01T12:00:20Z",
  "payload": { "intervalMs": 15000 }
}
```

`payload` requires `intervalMs` (integer `>= 1000`).

### `system.error`

Topic: `system`

```json
{
  "v": 1,
  "topic": "system",
  "type": "system.error",
  "id": "msg_01H...",
  "seq": 47,
  "ts": "2024-05-01T12:00:25Z",
  "payload": {
    "code": "rate_limited",
    "message": "Too many requests",
    "recoverable": true,
    "retryAfterMs": 2000
  }
}
```

`payload` requires `code`, `message`, and `recoverable`; `retryAfterMs` is optional.

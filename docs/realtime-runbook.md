# Realtime Layer: Architecture & Operational Runbook

This document describes the optional realtime layer that sits in front of the
REST API. It is written for maintainers and for the backend team working on
`refract-backend`. Every path referenced here exists in this repository so the
document can be cross-checked against the code.

> **Status:** the realtime backend contract is *documented, not yet implemented
> upstream*. See `src/lib/realtime/client.ts` — the client is written against the
> contract below, but `refract-backend` does not serve it yet. Until it does,
> every topic falls back to REST (see [Fallback to REST](#fallback-to-rest)).

## Module layout

| Path | Responsibility |
| --- | --- |
| `src/lib/realtime/client.ts` | Connection lifecycle, subscribe/unsubscribe, reconnect + heartbeat |
| `src/lib/realtime/capabilities.ts` | Capability negotiation and per-topic feature flags |
| `src/lib/realtime/merge.ts` | Merging realtime payloads into the REST cache |
| `src/lib/realtime/shadow.ts` | Shadow mode: observe realtime without serving it to the UI |
| `public/flags.json` | Runtime flag defaults (served statically) |

## Topic / message contract

The contract is authoritative here and is cross-checked against the schema
module. A topic is a string identifier; a message is a JSON envelope:

```jsonc
{
  "topic": "<topic-id>",      // e.g. "orders", "inventory"
  "type": "update",           // "update" | "snapshot" | "heartbeat"
  "seq": 42,                  // monotonically increasing per topic
  "payload": { /* topic-specific */ }
}
```

- `seq` is used by `merge.ts` to drop out-of-order or duplicate messages.
- `snapshot` replaces the local view for a topic; `update` is applied on top.
- `heartbeat` carries no payload and only refreshes connection health.

## Connection state machine

`client.ts` drives the following states:

```
idle ──connect──▶ connecting ──open──▶ open
                     │                  │
                     │ error            │ error / close
                     ▼                  ▼
                  closed ◀──────── reconnecting ──(backoff)──▶ connecting
```

- **idle** — no socket, no subscriptions.
- **connecting** — socket opening; negotiation runs here.
- **open** — subscribed; heartbeats expected at the configured interval.
- **reconnecting** — exponential backoff after an error or missed heartbeat.
- **closed** — terminal until a consumer subscribes again.

## Fallback to REST

Realtime is **optional**. When any of the following is true, the layer falls
back to REST transparently:

1. The realtime endpoint is not configured.
2. Capability negotiation (`capabilities.ts`) reports the topic unsupported.
3. The socket is not `open` (idle/connecting/reconnecting/closed).
4. The backend does not implement the contract (current state upstream).

In fallback mode the UI reads through the normal REST path; realtime messages,
when present, are merged on top via `merge.ts`. Consumers never need to branch
on realtime availability.

## Feature flag matrix

Flags live in `public/flags.json`. **Realtime is off by default** — do not assume
it is enabled.

| Flag | Default | Effect |
| --- | --- | --- |
| `realtime.enabled` | `false` | Master switch for the realtime layer |
| `realtime.shadow` | `false` | Observe realtime without serving it to the UI |
| `realtime.topics.<topic>` | `false` | Per-topic enablement |

Disabling a topic (e.g. `orders`) means setting `realtime.topics.orders` to
`false`; the topic then serves exclusively from REST.

## Cross-repo dependency: `refract-backend`

The realtime contract above must be implemented in `refract-backend`. Until it
is, this repository ships the client, negotiation, merge, and shadow logic but
runs entirely on the REST fallback. Backend-side documentation is out of scope
for this repo.

## Operational runbook

### "Data stopped updating"

1. Check the connection state (see health metrics below). If not `open`, the
   client is on the REST fallback — confirm REST is returning fresh data.
2. Verify `realtime.enabled` and the relevant `realtime.topics.<topic>` flag in
   `public/flags.json`.
3. Check `seq` continuity in `merge.ts` logs; a gap means dropped messages.
4. If heartbeats are missing, the client will be in `reconnecting`; confirm the
   backend is emitting `heartbeat` messages.

### Reading connection health metrics

- **state** — current state from the state machine above.
- **lastHeartbeat** — timestamp of the last `heartbeat`; stale means the socket
  is likely dead even if it looks open.
- **reconnectCount** — rising counts indicate an unstable backend.
- **fallbackActive** — `true` when serving from REST.

### Disabling a topic via flags

Set `realtime.topics.<topic>` to `false` in `public/flags.json` (or override at
runtime). The topic immediately serves from REST; no redeploy of the client is
required.

### Running the local mock server

Use the local mock server to develop against the contract before the backend
implements it. Point the client at the mock endpoint via the realtime endpoint
configuration and enable `realtime.enabled` locally. The mock emits `snapshot`,
`update`, and `heartbeat` envelopes matching the contract above so `merge.ts`
and `shadow.ts` can be exercised end to end.

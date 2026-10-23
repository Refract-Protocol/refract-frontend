# Realtime Layer: Architecture & Operational Runbook

This document describes the optional realtime layer that sits alongside the
REST path. It is written for maintainers and for the `refract-backend` team.

> **Status:** the realtime backend contract is *documented, not yet implemented
> upstream*. The client code in `src/lib/realtime/client.ts` is written against
> the contract below, but `refract-backend` does not yet serve it. Until it
> does, the layer stays behind feature flags (see the flag matrix) and every
> consumer falls back to REST.

## Module layout

The docs mirror the actual module layout so every path below is verifiable:

| Path | Responsibility |
| --- | --- |
| `src/lib/realtime/client.ts` | Connection lifecycle, subscribe/unsubscribe, reconnect |
| `src/lib/realtime/capabilities.ts` | Capability negotiation with the backend |
| `src/lib/realtime/merge.ts` | Merging realtime payloads into cached REST data |
| `src/lib/realtime/shadow.ts` | Shadow mode: observe realtime without applying it |
| `public/flags.json` | Per-topic feature flag defaults |

## Topic / message contract

The contract is authoritative here and is cross-checked against the schema
module. A client subscribes to a **topic** (a string key, e.g. a resource
collection). The backend pushes **messages** on that topic.

A message has the shape:

```jsonc
{
  "topic": "<topic key>",        // must match the subscribed topic
  "type": "update" | "delete",  // mutation kind
  "payload": { /* resource */ }, // full resource for update, id for delete
  "seq": 12345                   // monotonic per-topic sequence number
}
```

- `seq` is monotonic per topic and is used to detect gaps and stale messages.
- Messages are applied through `merge.ts`, which reconciles them with the
  cached REST snapshot rather than replacing it wholesale.
- Unknown `type` values are ignored (forward compatibility).

## Connection state machine

`client.ts` drives a small state machine:

```
idle ──connect──▶ connecting ──open──▶ open
                     │                  │
                     │ error            │ error / close
                     ▼                  ▼
                 reconnecting ◀─────────┘
                     │
                     │ (backoff exhausted)
                     ▼
                 fallback (REST only)
```

- **idle**: no socket, no intent to connect.
- **connecting**: socket opening; capability negotiation runs here.
- **open**: subscribed and receiving messages; heartbeat keeps it alive.
- **reconnecting**: transient failure; exponential backoff with jitter.
- **fallback**: realtime disabled for this session; REST polling resumes.

Heartbeat: the client expects periodic pings; a missed heartbeat window
moves the connection to `reconnecting`.

## Fallback-to-REST semantics

Realtime is **optional**. When any of the following is true, the client uses
REST only and never blocks the UI:

- the realtime feature flag for the topic is off (the default),
- capability negotiation fails or the backend does not advertise realtime,
- the connection enters `fallback` after backoff is exhausted.

Fallback is silent to the user: data still loads over REST. Realtime, when
available, only *augments* the REST snapshot via `merge.ts`.

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

## Cross-repo dependency: `refract-backend`

The realtime contract above must be implemented in `refract-backend`. Until
that lands, treat this document as the spec the backend is built against.
Changes to the contract require a coordinated change in both repos.

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

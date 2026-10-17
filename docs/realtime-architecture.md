# Realtime Layer Architecture

This document describes the architecture, topic contract, connection state machine, fallback semantics, and feature flag matrix for the `refract-frontend` realtime layer (`src/lib/realtime/`).

> [!IMPORTANT]
> **Upstream Backend Status**: The streaming WebSocket/SSE endpoints on `refract-backend` are currently documented as a target contract and are **not enabled by default in production**. By default, `realtimeEnabled` is `false` in `public/flags.json`, and all data hooks operate over polled REST via `src/lib/api/client.ts`.

---

## 1. Module Overview

- `src/lib/realtime/client.ts`: Core `RealtimeClient` managing WebSocket lifecycle, topic subscriptions, heartbeat keepalive, and reconnection backoff.
- `src/hooks/useRealtimeTopic.ts`: React hook primitive subscribing components to a topic while falling back cleanly to REST polling when realtime is disabled or degraded.
- `public/flags.json`: Runtime feature flag configuration controlling global and per-topic realtime rollout.

---

## 2. Topic & Message Contract

### Supported Topics

| Topic Pattern | Scope | Direction | Payload Summary | Priority |
| --- | --- | --- | --- | --- |
| `oracle:<pair>` (e.g. `oracle:XLM/USD`) | Public | Server -> Client | Latest oracle price, round ID, confidence interval, and server timestamp | Bulk |
| `pool:<poolId>` (e.g. `pool:main`) | Public | Server -> Client | Total value locked (TVL), reserve ratio, utilization bps, APY | Bulk |
| `claims:<walletAddress>` | Wallet-scoped | Server -> Client | Claim status transitions (`pending`, `voting`, `approved`, `rejected`, `settled`) | Critical |
| `notifications:<walletAddress>` | Wallet-scoped | Server -> Client | User-facing alerts, payout confirmations, policy expiry warnings | Critical |

### Wire Frame Envelope

Outbound client control frames:
```json
{
  "type": "subscribe",
  "topic": "oracle:XLM/USD",
  "cursor": "cur-1042"
}
```

Inbound server event frames:
```json
{
  "type": "event",
  "topic": "oracle:XLM/USD",
  "eventId": "evt-9081",
  "sequence": 42,
  "cursor": "cur-1043",
  "timestamp": 1700000000000,
  "payload": {
    "pair": "XLM/USD",
    "price": "0.1245000",
    "updatedAt": 1700000000000
  }
}
```

---

## 3. Connection State Machine & Transport Fallback

```
[disconnected]
      │ connect()
      ▼
[connecting] ──(handshake ok)──► [connected]
      │                               │
      │ (error / timeout)             │ (close / heartbeat timeout)
      ▼                               ▼
[reconnecting] ◄──────────────────────┘
      │
      │ (exceeds failure threshold / circuit breaker opens)
      ▼
[fallback: SSE -> Long-Poll -> REST Polling]
```

### Fallback Hierarchy
1. **WebSocket (`ws` / `wss`)**: Primary full-duplex transport when `NEXT_PUBLIC_WS_URL` is configured and reachable.
2. **Server-Sent Events (`SSE`)**: Unidirectional streaming fallback when WebSocket upgrades are blocked by proxies or firewalls.
3. **Cursor Long-Polling (`GET`)**: Sequential HTTP long-poll fallback for environments lacking both `WebSocket` and `EventSource`.
4. **REST Polling (`src/lib/api/client.ts`)**: Guaranteed baseline source of truth when realtime flags are off or when the circuit breaker opens after repeated transport failures.

---

## 4. Feature Flag Matrix

Flags are served from `public/flags.json` (and overridable in local development):

| Flag Key | Default | Description |
| --- | --- | --- |
| `realtimeEnabled` | `false` | Master switch for the realtime transport layer. When `false`, no WebSocket/SSE connections are opened. |
| `realtimeShadowMode` | `false` | Runs the realtime transport in background shadow mode, comparing pushed frames against polled REST values without rendering realtime data. |
| `realtimeTopics.oracle` | `false` | Enables live push updates for `oracle:*` topics when `realtimeEnabled` is `true`. |
| `realtimeTopics.claims` | `false` | Enables live push updates for `claims:*` topics when `realtimeEnabled` is `true`. |
| `realtimeTopics.pool` | `false` | Enables live push updates for `pool:*` topics when `realtimeEnabled` is `true`. |
| `realtimeTopics.notifications` | `false` | Enables live push updates for `notifications:*` topics when `realtimeEnabled` is `true`. |

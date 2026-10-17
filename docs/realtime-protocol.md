# Refract Realtime Protocol & Message Contract (v1)

> **Status:** Authoritative Specification (`v1`)  
> **Companion Module:** `src/lib/realtime/contract.ts`  
> **Client Transport:** `src/lib/realtime/client.ts`  
> **Feature Flags:** `public/flags.json`

## 1. Overview

This document defines the versioned realtime wire contract between `refract-frontend` and `refract-backend` across four canonical topics:

1. `oracle.readings` — Live oracle risk readings and trigger evaluations.
2. `claims.settlement` — Automated claim evaluations and on-chain payout disbursements.
3. `pool.stats` — Liquidity pool TVL, utilization, APY, and share price updates.
4. `notifications` — Wallet-scoped and protocol-wide user alerts.

Callers must treat the realtime stream as an low-latency overlay on top of REST snapshots: initial state is always hydrated via REST (`/oracle/status`, `/claims/*`, `/pool/stats`), and realtime frames are merged idempotently using each message's deduplication key.

---

## 2. Common Envelope Format

Every topic data frame sent over WebSocket or Server-Sent Events (SSE) shares a versioned JSON envelope:

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `v` | `1` | Yes | Protocol major version (`REALTIME_PROTOCOL_VERSION = 1`). |
| `id` | `string` | Yes | Globally unique frame identifier for transport-level deduplication. |
| `topic` | `string` | Yes | One of `"oracle.readings"`, `"claims.settlement"`, `"pool.stats"`, `"notifications"`. |
| `type` | `string` | Yes | `"snapshot"`, `"delta"`, or `"event"`. |
| `seq` | `number` | Yes | Monotonically increasing per-topic sequence number (`>= 0`). |
| `ts` | `number` | Yes | Server emission timestamp in Unix milliseconds (`> 0`). |
| `payload` | `object` | Yes | Per-topic payload conforming to `TOPIC_PAYLOAD_SCHEMAS[topic]`. |

---

## 3. Transport Selection & Justification per Topic

| Topic | Feature Flag | Primary Transport | Fallback Transport | Delivery Semantics | Rationale |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `oracle.readings` | `realtime-oracle` | WebSocket | SSE | `best-effort-latest` | Multiplexed with other topics on a single bidirectional socket; latest reading supersedes prior values for the same `coverageType`. |
| `claims.settlement` | `realtime-claims` | WebSocket | SSE | `at-least-once-ordered` | Requires cursor replay (`seq`) across reconnects so no settlement transition is missed. |
| `pool.stats` | `realtime-pool` | WebSocket | SSE | `best-effort-latest` | Periodic aggregate metrics where only the newest snapshot/delta matters. |
| `notifications` | `realtime-notifications` | WebSocket | SSE | `at-least-once-ordered` | Requires authenticated wallet-scoped subscription messages and cursor replay on reconnect. |

**Why WebSocket primary with SSE fallback?**
- **WebSocket** multiplexes all active topics, heartbeats (`ping`/`pong`), cursor replay (`subscribe` with `cursor`), and wallet-scoped auth refreshes over a single connection without hitting HTTP/1.1 connection limits.
- **SSE** provides a transparent fallback when corporate proxies or middleboxes block `Upgrade: websocket` handshakes while still delivering the exact same JSON envelope inside `data:` frames.

---

## 4. Topic Specifications & Validated Examples

### 4.1 `oracle.readings`
- **Delivery:** `best-effort-latest`
- **Idempotency / Dedup Key:** `oracle.readings:${payload.coverageType}:${seq}`
- **Merge Rule:** Replace the entry matching `payload.coverageType` in the readings list if `seq` is newer than the last applied sequence for that coverage type.

```json
{
  "v": 1,
  "id": "evt_oracle_001",
  "topic": "oracle.readings",
  "type": "delta",
  "seq": 42,
  "ts": 1730000000123,
  "payload": {
    "coverageType": "USDC Depeg",
    "type": "oracle_update",
    "value": 0.9985,
    "threshold": 0.95,
    "severity": "low",
    "message": "USDC peg stable across monitored DEX pools"
  }
}
```

### 4.2 `claims.settlement`
- **Delivery:** `at-least-once-ordered`
- **Idempotency / Dedup Key:** `claims.settlement:${payload.policyId}:${payload.processedAt}`
- **Merge Rule:** Upsert into `useClaims` / `useRecentClaims` by `(policyId, processedAt)` and sort descending by `processedAt`.

```json
{
  "v": 1,
  "id": "evt_claim_001",
  "topic": "claims.settlement",
  "type": "event",
  "seq": 108,
  "ts": 1730000005000,
  "payload": {
    "policyId": "pol_stellar_99812",
    "holder": "GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR",
    "coverageType": 1,
    "triggered": true,
    "payout": "25000000000",
    "reason": "Flight BA-284 delayed 215 minutes beyond threshold",
    "processedAt": 1730000004,
    "settlementTxHash": "8f4b2e1c9d0a3b5e7f6a1c2d4e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f"
  }
}
```

### 4.3 `pool.stats`
- **Delivery:** `best-effort-latest`
- **Idempotency / Dedup Key:** `pool.stats:${seq}`
- **Merge Rule:** Apply if `seq` is strictly greater than the last applied `pool.stats` sequence number.

```json
{
  "v": 1,
  "id": "evt_pool_001",
  "topic": "pool.stats",
  "type": "snapshot",
  "seq": 19,
  "ts": 1730000010000,
  "payload": {
    "totalUsdc": "5000000000000",
    "totalShares": "4850000000000",
    "lockedUsdc": "1250000000000",
    "premiumAccrued": "150000000000",
    "availableUsdc": "3750000000000",
    "utilizationBps": 2500,
    "apyBps": 840,
    "sharePrice": 1.0309,
    "maxUtilizationBps": 8000
  }
}
```

### 4.4 `notifications`
- **Delivery:** `at-least-once-ordered`
- **Idempotency / Dedup Key:** `notifications:${payload.id}`
- **Merge Rule:** Upsert by `payload.id`, preserve local `read: true` state if already marked read by the user, and sort descending by `timestamp`.

```json
{
  "v": 1,
  "id": "evt_notif_001",
  "topic": "notifications",
  "type": "event",
  "seq": 7,
  "ts": 1730000015000,
  "payload": {
    "id": "claim-pol_stellar_99812-1730000004",
    "type": "claim_payout",
    "title": "Claim Payout Disbursed",
    "message": "$2,500.00 was automatically disbursed for policy pol_stel… (Flight delayed).",
    "timestamp": 1730000004000,
    "read": false,
    "href": "/dashboard",
    "severity": "success",
    "walletAddress": "GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR"
  }
}
```

---

## 5. Control, Resume, Heartbeat & Error Frames

### 5.1 Subscribe & Cursor Replay (`subscribe`)
Sent by the client upon connection open or topic registration. Includes optional per-topic `cursor` (`seq` numbers) and optional wallet authentication for `notifications`.

```json
{
  "v": 1,
  "type": "subscribe",
  "id": "ctl_sub_001",
  "ts": 1730000020000,
  "topics": ["oracle.readings", "claims.settlement", "notifications"],
  "cursor": {
    "claims.settlement": 107,
    "notifications": 6
  },
  "auth": {
    "walletAddress": "GBDEVU63Y6NTHJQQZIKVTC23NWLQVP3WJ2RI2OTSJTNYOIGICST6DUXR",
    "token": "sep10_jwt_token_example"
  }
}
```

### 5.2 Unsubscribe (`unsubscribe`)

```json
{
  "v": 1,
  "type": "unsubscribe",
  "id": "ctl_unsub_001",
  "ts": 1730000025000,
  "topics": ["pool.stats"]
}
```

### 5.3 Resume Acknowledgement (`resume_ack`)
Sent by the server in response to a `subscribe` frame with a `cursor`. If the server's replay buffer still covers `fromSeq`, `mode` is `"replayed"`; if the cursor is too old, `mode` is `"resync_required"` and the client immediately triggers a fresh REST snapshot fetch.

```json
{
  "v": 1,
  "type": "resume_ack",
  "id": "ctl_resume_001",
  "ts": 1730000020100,
  "topic": "claims.settlement",
  "mode": "replayed",
  "fromSeq": 107,
  "latestSeq": 108
}
```

### 5.4 Heartbeat Keepalive (`ping` / `pong`)
The client emits a `ping` frame every `25_000 ms` when idle and expects a `pong` within `10_000 ms`. `serverTs` allows the client to estimate server/client clock skew.

```json
{
  "v": 1,
  "type": "ping",
  "id": "hb_ping_001",
  "ts": 1730000030000
}
```

```json
{
  "v": 1,
  "type": "pong",
  "id": "hb_ping_001",
  "ts": 1730000030000,
  "serverTs": 1730000030045
}
```

### 5.5 Error Frame (`error`)

```json
{
  "v": 1,
  "type": "error",
  "id": "err_001",
  "ts": 1730000035000,
  "code": "RATE_LIMITED",
  "message": "Subscription mutation rate exceeded; back off before retrying",
  "topic": "oracle.readings",
  "retryAfterMs": 5000
}
```

---

## 6. Edge Cases, Limits & Forward Compatibility

1. **Missed Messages & Reconnect Cursor Replay:**
   - When `seq` jumps by more than `1` on an `at-least-once-ordered` topic (`claims.settlement`, `notifications`), or when the server replies with `mode: "resync_required"`, the client triggers an out-of-band REST snapshot refetch and reconciles via deduplication keys.
2. **Duplicate & Out-of-Order Delivery:**
   - Every consumer deduplicates frames using `getEnvelopeDedupKey(envelope)` and ignores frames whose `seq` is older than the highest applied sequence for that topic/entity.
3. **Clock Skew on `ts`:**
   - Relative-time UI indicators use `serverTs - ts` from `pong` frames to normalize server timestamps against the local monotonic clock so skewed client clocks never display negative elapsed times.
4. **Unknown Topic / Version Forward Compatibility:**
   - Frames with `v !== 1` or an unknown `topic` are ignored and counted by the transport validator without throwing or tearing down the socket.
   - All payload and envelope schemas use `.passthrough()` so new optional fields added by `refract-backend` in minor revisions do not break validation.
5. **Maximum Payload Size & Backpressure:**
   - Maximum frame size is `64 KiB` (`MAX_REALTIME_FRAME_BYTES = 65536`). Frames exceeding this limit are dropped before JSON parsing.
   - High-frequency `oracle.readings` updates may be coalesced per animation frame (`16 ms`) on the client while ordered topics (`claims.settlement`, `notifications`) are buffered up to a bounded queue capacity before triggering a REST resync.

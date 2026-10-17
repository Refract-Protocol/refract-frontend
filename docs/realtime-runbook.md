# Realtime Layer Operational Runbook

This runbook provides step-by-step diagnostic and mitigation procedures for developers and on-call engineers investigating realtime data issues in `refract-frontend`.

---

## 1. Diagnosing "Data Stopped Updating"

When a user or QA report states that oracle prices, claims, or pool statistics appear frozen:

### Step 1: Verify Feature Flag & Kill-Switch State
1. Inspect `public/flags.json` (or network response for `/flags.json` in DevTools).
2. Confirm whether `realtimeEnabled` is `true` or `false`:
   - If `false`, the app is operating in **REST-only mode** via `src/lib/api/client.ts`. Investigate REST endpoint latency or HTTP `429`/`5xx` errors in the Network tab.
   - If `true`, check whether the specific topic flag (`realtimeTopics.oracle`, `realtimeTopics.claims`, etc.) is enabled.

### Step 2: Check Transport State & Circuit Breaker
1. Open Browser DevTools -> **Network** -> **WS** (WebSockets) or **EventStream** (SSE).
2. Look for repeated failed handshakes (`1006`, `403`, `502`, `503`):
   - After consecutive failures, the realtime circuit breaker transitions to `open` and automatically falls back to REST polling for the cooldown window.
3. Check whether a heartbeat timeout occurred (no `pong` or inbound traffic within the idle timeout window).

### Step 3: Check Sequence Gaps & Clock Skew
1. If frames are arriving in the WS inspector but the UI does not update:
   - Check if the inbound `sequence` or `timestamp` is older than the currently rendered REST snapshot (the merge layer drops stale out-of-order frames).
   - Check client system clock skew: if the user's device clock is significantly ahead of server time, unnormalized timestamp comparisons may treat fresh server events as stale.

---

## 2. Disabling a Misbehaving Topic via Flags (Emergency Rollback)

If a realtime topic emits malformed frames or diverges from authoritative Soroban/REST state:

1. **Per-Topic Disable**: Set `realtimeTopics.<topic>` to `false` in `public/flags.json` (or via runtime override). Active hooks for that topic will immediately tear down their subscription and revert to REST polling.
2. **Global Emergency Kill-Switch**: Set `"realtimeEnabled": false` in `public/flags.json`. The `RealtimeClient` in `src/lib/realtime/client.ts` will close the active socket, clear pending reconnect timers, and route all hooks through `src/lib/api/client.ts`.

---

## 3. Running & Developing Locally Against Mock Realtime Events

Because the upstream `refract-backend` WebSocket endpoint is optional in local development:

1. Keep `NEXT_PUBLIC_WS_URL` unset (or `realtimeEnabled: false`) during standard UI work to rely on REST mocks and local API fixtures.
2. To test realtime state transitions, reconnects, and sequence gaps deterministically in unit/integration tests, use the Vitest suite under `src/lib/realtime/`:
   ```bash
   npx vitest run src/lib/realtime/
   ```
3. To reproduce a captured production/staging incident locally, export the redacted JSON session bundle from the session recorder and feed it into `RealtimeReplayHarness`.

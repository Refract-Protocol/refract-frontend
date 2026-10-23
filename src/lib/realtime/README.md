# Realtime contract

The browser connects to `/ws` after the app has hydrated when `realtime-oracle` is enabled. The shell checks `navigator.connection.saveData`, `(prefers-reduced-data: reduce)`, and the `setRealtimeOptOut` preference before warming. Hovering or focusing a link to `/cover` or `/provide` also warms the shared client. A warm connection with no topic subscribers closes after 15 seconds. Hooks only subscribe to the shared client and map each wire payload to a REST-shaped domain value.

Domain frames have the shape `{ "topic": "oracle_update", "payload": ... }`, `{ "topic": "claim_update", "payload": ... }`, or `{ "topic": "notification_update", "payload": ... }`. The claim mapper converts the backend Unix seconds to the shared frontend Unix milliseconds used by REST-derived data. Claim amounts remain base-unit strings. Unknown, malformed, or unexpected payloads are dropped and reported to the console.

The reserved `$control` topic never reaches domain handlers. Its payload types are:

- `{ "type": "ping" }` / `{ "type": "pong" }`: the client sends a ping every 30 seconds while a topic is subscribed; the server must answer with pong within 10 seconds or the client reconnects.
- `{ "type": "revocation", "topic": "oracle_update", "reason": "..." }`: remove the topic handlers and show the reason; that topic is not retried.
- `{ "type": "maintenance", "until": 1792600000000, "reason": "..." }`: postpone a reconnect until the later of the maintenance deadline and current backoff.
- `{ "type": "drain", "until": 1792600000000, "reason": "..." }`: same reconnect behavior during graceful server drain.
- `{ "type": "drain-complete" }`: clear the maintenance deadline and reconnect immediately if topics remain subscribed.

`RealtimeClient` accepts an injected clock and socket factory. Realtime unit tests use Vitest fake timers through `fakeRealtimeClock`; browser tests should wait on observable UI state rather than sleeping for an assumed duration.

# Realtime layer

Contract: `src/lib/realtime/contract.ts` (topics, validators, fixtures, frames).

## Request/response

`realtimeClient.request(topic, payload, { timeoutMs, signal })` multiplexes a
one-shot query over the open WebSocket.

- Client frame: `{ id, topic, request }`; server replies `{ id, response }` or
  `{ id, error: { code, message } }`. Frames with an `id` never reach topic
  subscribers.
- Rejects with `RealtimeRequestError` (`timeout | aborted | disconnected |
  overflow | server`). Pending requests reject on disconnect/reconnect and are
  never replayed; at most 100 may be in flight. Payloads are never logged.
- SSE/long-poll fallbacks do not support requests; use REST.

## Testing

Use the fake transport from `@/lib/realtime/testing` (tests only — never import
it from production code):

```ts
const fake = installFakeRealtime();
realtimeClient.subscribe("oracle_update", handler);
fake.current.open();
fake.current.emit("oracle_update", { severity: "triggered", value: 9 }); // typed from the contract
fake.current.drop(); // force close; advance fake timers for reconnect
afterEach(() => fake.teardown());
```

`src/lib/realtime/__tests__/topicCoverage.test.ts` fails when a contract topic
lacks a mock producer, a consumer, or valid fixtures (see its allowlist).

# Realtime rollout and rollback runbook

## Flags (`public/flags.json`)

`realtime-enabled` (global kill switch) plus `realtime-oracle`, `realtime-claims`, `realtime-pool`, `realtime-notifications`. A topic is live only when **both** the kill switch and its own flag are `true` (`isRealtimeTopicEnabled`, `src/lib/realtime/flags.ts` — the single helper every consumer must use). All default to `false`. Missing, malformed or stale flag documents resolve to off. The file is public: booleans only, no secrets or internal hostnames.

Flags are read from the same cached `/flags.json` in every tab, so tabs converge within `FLAGS_CACHE_TTL_MS` (5 min). Turning a topic off calls `realtimeClient.setFlags(...)`: the topic is unsubscribed on the wire and each subscriber's `onDisabled` fires so its hook falls back to REST — never a live subscription rendering nothing.

## Stages

| Stage | Audience | Advance when (over ≥ 24h) |
| --- | --- | --- |
| 1. mock/dev | `npm run mock:realtime` + `NEXT_PUBLIC_FLAGS_OVERRIDE` | smoke tests green |
| 2. internal | staging, one topic at a time (oracle → pool → claims → notifications) | connection success ≥ 99%, reconnects < 1 per session-hour, REST fallback < 1% of sessions |
| 3. allowlist / percentage | ship flag with wider audience | same thresholds hold at each step |
| 4. default-on | flip `realtime-enabled` and topic flags to `true` in `flags.json` | thresholds hold for a week |

## Rollback

1. Single topic: set that topic's flag to `false` in `public/flags.json` and deploy/publish the file. Everything: set `realtime-enabled` to `false`.
2. Verify: open the app, confirm no WebSocket to `/ws` for the topic in devtools → Network → WS, and that the hook's data still loads (REST). `realtimeClient.getState()` should be `idle`.
3. Notify: the on-call/maintainers channel and the backend owners of `refract-backend`; note the topic, time and symptom.

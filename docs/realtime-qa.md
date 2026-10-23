# Realtime QA controls

On local development hosts, add `?realtime=off`, `?realtime=ws`, `?realtime=sse`, or `?realtime=mock` to select a realtime mode. Add `&realtimeEndpoint=https%3A%2F%2F...` to point the client at a mock or staging endpoint. The query selection is held in `sessionStorage` for the current tab and never written to shared local storage. The amber QA status badge identifies an active override and its reset action clears it.

In production builds, the override surface is active only for hosts named by the comma-separated `NEXT_PUBLIC_REALTIME_OVERRIDE_HOSTS` build variable (empty by default). The production remote `public/flags.json` value `flags.realtime-oracle` is checked first; false, missing, or unreachable values disable realtime even if a query override requests it. Set the remote flag true only in an environment meant to exercise realtime.

`ws` selects WebSocket, `sse` selects EventSource, `mock` uses the WebSocket protocol at the supplied endpoint, and `off` disables realtime. REST polling is used when a streaming API is unavailable or environment configuration selects REST. The expected frame shape is `{ "topic": "oracle_update", "payload": {}, "sequence": 1 }`. Frames larger than 256 KiB or nested more than 32 levels are dropped before application handlers run.

Lifecycle analytics are emitted through `setRealtimeAnalyticsSink` in `src/lib/analytics/realtime.ts`. They are batched into a microtask, deduplicated for one minute, bounded to 64 queued events, and suppressed for Do Not Track or Save-Data. Payloads contain only lifecycle name, coarse transport/topic/network dimensions, a flag bucket, and timestamp. Applications can attach a vendor-neutral sink without adding an SDK to the realtime client.

To check a local QA session, open the app with `?realtime=sse`, confirm the amber badge reads “QA realtime: sse”, then use the reset action and confirm the badge disappears. The deterministic hostile-frame corpus is run with `npm test -- src/lib/realtime/decode.fuzz.test.ts`.

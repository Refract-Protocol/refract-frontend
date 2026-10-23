# Realtime resilience and performance

Realtime data uses the existing REST endpoints during cold start and after subscription failure. The client caches topic snapshots by network, wallet and topic; entries carry a version and capture time and render as stale until a REST response or realtime push supersedes them. IndexedDB is optional, and storage failures never block the page.

`RealtimeBoundary` isolates a route's live region. A render or subscription handler failure marks the topic degraded and renders its fallback. Retry clears that topic's degraded state. Diagnostics include topic, route, transport and error type only; payloads and wallet addresses are omitted.

The development-only React Profiler records commits and actual durations by topic. Run `NEXT_PUBLIC_REALTIME_PROFILER=1 npm run dev`, then `npm run realtime:benchmark`. The scripted benchmark measures five runs with the socket disconnected and five runs with 100 oracle pushes at 25 Hz on landing, `/cover` and `/provide`; it reports both scenarios' median commit time, p95 commit time, long tasks, and p98 event duration to `reports/realtime-benchmark.json`.

Budgets are checked in at `reports/realtime-benchmark-baseline.json`: median commit duration below 16 ms, p95 commit duration below 50 ms, no long tasks during the scripted stream, and p98 interaction duration below 200 ms. These thresholds allow CI variance while flagging work that exceeds a frame or the Core Web Vitals INP “good” threshold. Lighthouse CI separately warns on INP above 200 ms and total blocking time above 200 ms. Absolute measurements vary by runner; compare like-for-like CI runs and use the median of five benchmark runs.

# Realtime operations and boundaries

## Emergency disable

Serve `/realtime-control.json` from the frontend origin or its CDN with a cache lifetime no longer than five seconds and purge it when tripping the switch. Set `{ "disabled": true }` to stop new connections and close active sockets. Clients check at startup, before reconnects, every five seconds, and when a tab becomes visible. Fetches have a three second timeout and never block app startup. A failed fetch keeps the last known state. The switch is latched in a running page; restoring `{ "disabled": false }` does not re-enable a tripped client. Reload clients after the incident is resolved. `tripKillSwitch("manual" | "auto")` is available to operator/developer code and logs the source. The current implementation does not automatically trip on connection failures.

The checked-in JSON is a safe serving default. Production operations must publish and purge the same JSON through the configured CDN/backend path; frontend-only deployment is not required. Coordinate the control path and cache TTL with refract-backend/on-call before enabling realtime.

## Endpoint policy

`NEXT_PUBLIC_API_URL` selects the API and its corresponding `ws:`/`wss:` realtime origin. Keep it set in production, preview, and CI. Next emits `Content-Security-Policy-Report-Only`; review browser reports for one release before changing the header to enforced `Content-Security-Policy`. Add any intentional connection origin through the canonical API environment configuration, then validate the generated header. Development defaults to the local API at port 4001.

## Public module boundary

Consumers import supported APIs from `@/lib/realtime`. Files inside `src/lib/realtime/` are implementation details and may change. To make a new API public, add an explicit named export and its public type to `index.ts`; do not export internal helpers wholesale. The lint rule rejects deep imports outside the module, and is disabled only within the module itself.

## Page lifecycle

Hiding the document, `pagehide`, and `freeze` suspend the socket and cancel reconnect timers. Becoming visible, `pageshow`, and `resume` reconnect and consumers clear their live payload while suspended; their REST query remains authoritative. This repository currently has no outbound realtime mutation queue or cross-tab leader-election lease, so there is no pending realtime write or leader role to flush/relinquish.

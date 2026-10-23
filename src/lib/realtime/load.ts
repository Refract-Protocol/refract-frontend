/**
 * Dynamic-import boundary for the realtime layer (issue #248).
 *
 * UI code (hooks, providers) calls `loadRealtime()` instead of importing
 * ./client or ./entry statically. The named chunk makes the output
 * predictable (`.next/static/chunks/realtime.<hash>.js`) so `.size-limit.json`
 * can budget it and `scripts/check-realtime-bundle.mjs` can find it.
 */
export type RealtimeModule = typeof import("./entry");

let pending: Promise<RealtimeModule> | null = null;

export function loadRealtime(): Promise<RealtimeModule> {
  pending ??= import(/* webpackChunkName: "realtime" */ "./entry").catch((err) => {
    // Allow a later retry (e.g. after a flaky chunk download).
    pending = null;
    throw err;
  });
  return pending;
}

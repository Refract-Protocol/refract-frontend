/**
 * The realtime layer's single lazily-loaded entry (issue #248).
 *
 * Everything that ships the WebSocket client or payload validators to the
 * browser is reached through this module, and this module is only reached
 * through `loadRealtime()` in ./load (a dynamic import). That keeps the
 * realtime code in its own `realtime` chunk instead of the initial bundle.
 *
 * Never import from ./dev here: dev/test tooling must not reach production.
 */
import { RealtimeClient } from "./client";

export { RealtimeClient } from "./client";
export type { RealtimeDiagnostics, TopicHandler } from "./client";
export { parsePolicyEvent } from "./policyEvents";

let client: RealtimeClient | null = null;

/** The app-wide realtime client, created on first use. */
export function getRealtimeClient(): RealtimeClient {
  return (client ??= new RealtimeClient());
}

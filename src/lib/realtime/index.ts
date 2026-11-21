export { realtimeClient, RealtimeEndpointError } from "./client";
export type { RealtimeClient } from "./client";
export { useRealtimeTopic } from "./useRealtimeTopic";
export { bindRealtimeLifecycle } from "./lifecycle";
export { REALTIME_ENDPOINT, isAllowedRealtimeUrl } from "./allowlist";
export type { RealtimeEndpoint } from "./allowlist";
export const REALTIME_TOPICS = { ORACLE_UPDATE: "oracle_update" } as const;
export { isRealtimeDisabled, getKillSwitchState, tripKillSwitch } from "./killSwitch";
export type { KillSwitchState, KillSwitchSource } from "./killSwitch";

/**
 * Transport identifiers supported by the realtime client.
 * Kept in sync with the implementations in `./transports/`.
 */
export type RealtimeTransportKind = "websocket" | "sse" | "long-poll";

/**
 * Lazily load a single transport implementation so bundlers can split each
 * transport into its own chunk. Only the transport selected by the caller is
 * fetched at runtime, keeping the realtime entry chunk free of unused
 * WebSocket/SSE/long-poll code.
 */
export async function loadRealtimeTransport(
  kind: RealtimeTransportKind,
): Promise<unknown> {
  switch (kind) {
    case "websocket":
      return import("./transports/websocket");
    case "sse":
      return import("./transports/sse");
    case "long-poll":
      return import("./transports/longPoll");
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported realtime transport: ${String(exhaustive)}`);
    }
  }
}

import { API_BASE_URL } from "@/lib/api/client";
import { LongPollTransport } from "./transports/longPoll";
import { SseTransport } from "./transports/sse";
import type { TransportFactory } from "./transports/types";
import { WebSocketTransport } from "./transports/websocket";

export interface RealtimeCapabilities {
  websocket: boolean;
  eventSource: boolean;
  fetch: boolean;
}

export function detectCapabilities(
  env: Partial<typeof globalThis> = globalThis
): RealtimeCapabilities {
  return {
    websocket: typeof env.WebSocket === "function",
    eventSource: typeof env.EventSource === "function",
    fetch: typeof env.fetch === "function" && typeof env.AbortController === "function",
  };
}

export interface RealtimeEndpoints {
  websocket: string;
  sse: string;
  longPoll: string;
}

export function defaultEndpoints(apiBaseUrl: string = API_BASE_URL): RealtimeEndpoints {
  return {
    websocket: apiBaseUrl.replace(/^http/, "ws").replace(/\/api\/v1$/, "/ws"),
    sse: `${apiBaseUrl}/realtime/sse`,
    longPoll: `${apiBaseUrl}/realtime/poll`,
  };
}

/**
 * Transport tiers in preference order: WebSocket → SSE → long-poll.
 * When every tier is unsupported or fails to open, the client reports
 * `degraded` and callers keep their REST polling (the fourth tier).
 */
export function defaultTransportFactories(
  endpoints: RealtimeEndpoints = defaultEndpoints(),
  capabilities: () => RealtimeCapabilities = () => detectCapabilities()
): TransportFactory[] {
  return [
    {
      kind: "websocket",
      isSupported: () => capabilities().websocket,
      create: () => new WebSocketTransport({ url: endpoints.websocket }),
    },
    {
      kind: "sse",
      isSupported: () => capabilities().eventSource,
      create: () => new SseTransport({ url: endpoints.sse }),
    },
    {
      kind: "long-poll",
      isSupported: () => capabilities().fetch,
      create: () => new LongPollTransport({ url: endpoints.longPoll }),
    },
  ];
}

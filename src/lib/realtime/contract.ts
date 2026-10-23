/**
 * Realtime contract: the single source of truth for topics and frames.
 *
 * Push frame:      `{ topic, payload }`
 * Request frame:   `{ id, topic, request: payload }`           (client -> server)
 * Response frame:  `{ id, response: payload }`                  (server -> client)
 * Error frame:     `{ id, error: { code, message } }`           (server -> client)
 *
 * Frames carrying an `id` are matched by the correlation layer and are never
 * delivered to topic subscribers. Only the WebSocket transport supports
 * requests; SSE/long-poll fallbacks must degrade to REST.
 */

export interface TopicDef<T> {
  /** Runtime validator; returns the parsed payload or throws. */
  parse: (value: unknown) => T;
  fixtures: readonly unknown[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export interface OracleUpdatePayload {
  severity: "normal" | "high" | "triggered";
  value: number;
}

export const REALTIME_TOPICS = {
  oracle_update: {
    parse(value: unknown): OracleUpdatePayload {
      if (
        !isRecord(value) ||
        !["normal", "high", "triggered"].includes(value.severity as string) ||
        typeof value.value !== "number"
      ) {
        throw new Error("invalid oracle_update payload");
      }
      return value as unknown as OracleUpdatePayload;
    },
    fixtures: [
      { severity: "normal", value: 1 },
      { severity: "triggered", value: 9 },
    ],
  } satisfies TopicDef<OracleUpdatePayload>,
} as const;

export type RealtimeTopic = keyof typeof REALTIME_TOPICS;
export type TopicPayload<K extends RealtimeTopic> = ReturnType<(typeof REALTIME_TOPICS)[K]["parse"]>;

export interface RealtimeErrorFrame {
  code: string;
  message: string;
}

export type RealtimeResponseFrame =
  | { id: number; response: unknown }
  | { id: number; error: RealtimeErrorFrame };

export function isResponseFrame(frame: unknown): frame is RealtimeResponseFrame {
  return isRecord(frame) && typeof frame.id === "number" && ("response" in frame || "error" in frame);
}

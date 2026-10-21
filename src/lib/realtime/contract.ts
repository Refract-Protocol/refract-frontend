/** Wire topics and control frames for the frontend realtime connection. */
export const REALTIME_CONTROL_TOPIC = "$control";
export const REALTIME_TOPICS = {
  oracle: "oracle_update",
  claim: "claim_update",
  notification: "notification_update",
} as const;

/** Control frames use the reserved `$control` topic and never reach domain handlers.
 * `revocation` removes one topic subscription permanently; `maintenance` defers
 * reconnects until `until` (Unix milliseconds); `drain` enters the same deferred
 * state; `drain-complete` clears it and reconnects immediately when needed.
 */
export type RealtimeControl =
  | { type: "ping" }
  | { type: "pong" }
  | { type: "revocation"; topic: string; reason: string }
  | { type: "maintenance"; until: number; reason?: string }
  | { type: "drain"; until: number; reason?: string }
  | { type: "drain-complete" };

export interface RealtimeEnvelope {
  topic: string;
  payload: unknown;
}

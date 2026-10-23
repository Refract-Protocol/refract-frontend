/**
 * Realtime wire contract (see docs/realtime-protocol.md). Framework-agnostic:
 * shared by the transport, the merge layer and the mock server's tests.
 */
export const PROTOCOL_VERSION = 1;

export const REALTIME_TOPICS = ["oracle", "claims", "pool", "notifications"] as const;
export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

export interface OracleUpdate {
  id: string;
  price: string;
  updatedAt: number;
}
export interface ClaimUpdate {
  id: string;
  policyId: string;
  status: string;
  amount: string;
  updatedAt: number;
}
export interface PoolUpdate {
  id: string;
  tvl: string;
  utilization: number;
  updatedAt: number;
}
export interface NotificationEvent {
  id: string;
  kind: string;
  message: string;
  createdAt: number;
}

/** Per-topic payload types. */
export interface TopicPayloads {
  oracle: OracleUpdate;
  claims: ClaimUpdate;
  pool: PoolUpdate;
  notifications: NotificationEvent;
}

/** Server → client frame for a topic. `seq` is per-topic and monotonic; `ts` is epoch ms. */
export interface RealtimeMessage<T extends RealtimeTopic = RealtimeTopic> {
  v: typeof PROTOCOL_VERSION;
  topic: T;
  seq: number;
  ts: number;
  payload: TopicPayloads[T];
}

/** Maps each topic to its handler's message type. */
export type TopicMessageMap = { [T in RealtimeTopic]: RealtimeMessage<T> };

export type ClientOp =
  | { op: "subscribe"; topic: RealtimeTopic; cursor?: number }
  | { op: "unsubscribe"; topic: RealtimeTopic }
  | { op: "ping" };

/** Close code the server uses when it rejects the connection's credentials. */
export const CLOSE_AUTH_FAILED = 4401;

export type ParseResult =
  | { kind: "message"; message: RealtimeMessage }
  | { kind: "pong" }
  | { kind: "ignored"; reason: string };

/** Parses an inbound frame. Never throws; anything unrecognised is reported as ignored. */
export function parseFrame(raw: unknown): ParseResult {
  if (typeof raw !== "string") return { kind: "ignored", reason: "non-text frame" };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: "ignored", reason: "malformed json" };
  }
  if (!data || typeof data !== "object") return { kind: "ignored", reason: "not an object" };
  const f = data as Record<string, unknown>;
  if (f.op === "pong") return { kind: "pong" };
  if (f.v !== PROTOCOL_VERSION)
    return { kind: "ignored", reason: `unsupported version ${String(f.v)}` };
  if (typeof f.topic !== "string" || !(REALTIME_TOPICS as readonly string[]).includes(f.topic)) {
    return { kind: "ignored", reason: `unknown topic ${String(f.topic).slice(0, 32)}` };
  }
  if (!Number.isFinite(f.seq) || !Number.isFinite(f.ts))
    return { kind: "ignored", reason: "bad seq/ts" };
  if (!f.payload || typeof f.payload !== "object")
    return { kind: "ignored", reason: "bad payload" };
  return { kind: "message", message: f as unknown as RealtimeMessage };
}

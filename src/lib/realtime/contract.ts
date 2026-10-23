/** Every supported topic has an explicit scheduling class. Unknown topics are rejected. */
export const TOPICS = {
  claim_settlement: "critical",
  transaction_confirmation: "critical",
  auth: "critical",
  control: "critical",
  oracle_update: "bulk",
  pool_stats: "bulk",
  activity_feed: "bulk",
} as const;
export type Topic = keyof typeof TOPICS;
export type Priority = (typeof TOPICS)[Topic];
export interface Message {
  topic: Topic;
  payload: unknown;
  entityId?: string;
  version?: number;
  timestamp?: number;
}
export interface Interest {
  entityIds?: string[];
  minVersion?: number;
  minTimestamp?: number;
  fields?: string[];
  broad?: boolean;
}
export interface Descriptor {
  topic: Topic;
  interest: Interest;
}
export function validateMessage(value: unknown): Message {
  if (!value || typeof value !== "object") throw new Error("Invalid envelope");
  const m = value as Message;
  if (
    !Object.hasOwn(TOPICS, m.topic) ||
    !("payload" in m) ||
    (m.entityId !== undefined && typeof m.entityId !== "string") ||
    (m.version !== undefined && (!Number.isFinite(m.version) || m.version < 0)) ||
    (m.timestamp !== undefined && !Number.isFinite(m.timestamp))
  )
    throw new Error("Invalid envelope");
  return m;
}
export function descriptor(topic: Topic, interest: Interest): Descriptor {
  if (!Object.hasOwn(TOPICS, topic)) throw new Error("Unknown topic");
  const normalize = (values?: string[]) =>
    values ? [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort() : undefined;
  const entityIds = normalize(interest.entityIds);
  const fields = normalize(interest.fields);
  for (const floor of [interest.minVersion, interest.minTimestamp]) {
    if (floor !== undefined && (!Number.isFinite(floor) || floor < 0))
      throw new Error("Invalid cursor");
  }
  if (
    !interest.broad &&
    !entityIds?.length &&
    !(interest.minVersion !== undefined && interest.minVersion > 0) &&
    !(interest.minTimestamp !== undefined && interest.minTimestamp > 0)
  )
    throw new Error("Explicit broad interest required");
  return {
    topic,
    interest: {
      entityIds: entityIds?.length ? entityIds : undefined,
      minVersion: interest.minVersion,
      minTimestamp: interest.minTimestamp,
      fields: fields?.length ? fields : undefined,
      broad: interest.broad || undefined,
    },
  };
}
export function matches(m: Message, i: Interest): boolean {
  return (
    (!i.entityIds?.length || (m.entityId !== undefined && i.entityIds.includes(m.entityId))) &&
    (i.minVersion === undefined || (m.version !== undefined && m.version >= i.minVersion)) &&
    (i.minTimestamp === undefined || (m.timestamp !== undefined && m.timestamp >= i.minTimestamp))
  );
}

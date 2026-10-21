import { REALTIME_TOPICS, type RealtimeTopic } from "../contract";

/** Mock-server producer registry: one frame generator per contract topic. */
export const MOCK_PRODUCERS: Record<string, () => unknown> = {
  oracle_update: () => REALTIME_TOPICS.oracle_update.fixtures[0],
} satisfies Partial<Record<RealtimeTopic, () => unknown>>;

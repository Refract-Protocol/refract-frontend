import type { ClaimRecord, OracleReading, PoolStats } from "./generated";

export interface RealtimePayloads {
  oracle_update: OracleReading;
  claim_update: ClaimRecord;
  pool_update: PoolStats;
}

export type RealtimeTopic = keyof RealtimePayloads;

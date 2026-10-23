/** Typed topic map for the realtime client. */

/** Pseudonymous, pool-level activity only — never a wallet address or position size. */
export interface PoolActivityEvent {
  id: string;
  kind: "deposit" | "withdraw" | "coverage_written";
  /** Unix ms. */
  at: number;
  /** Aggregate USDC bucket label (e.g. "$1k–10k"), never an exact per-LP amount. */
  sizeBucket?: string;
}

export interface PoolPresence {
  /** Aggregate count of providers currently active. */
  active: number;
}

export interface TopicMap {
  oracle_update: unknown;
  pool_activity: PoolActivityEvent;
  pool_presence: PoolPresence;
}

export type TopicName = keyof TopicMap;

import type { OracleReading } from "@/lib/api/oracle";

export interface OracleFeedDisplay {
  feed: string;
  icon: string;
  formatValue: (r: OracleReading) => string;
}

/** Display metadata for each oracle feed, keyed by the reading's `coverageType` string. */
export const ORACLE_FEED_DISPLAY: Record<string, OracleFeedDisplay> = {
  StablecoinDepeg: { feed: "USDC/USD", icon: "🪙", formatValue: (r) => `$${r.value.toFixed(4)}` },
  MarketCrash: {
    feed: "Market 24h",
    icon: "📊",
    formatValue: (r) => `${r.value >= 0 ? "+" : ""}${r.value.toFixed(2)}%`,
  },
  SmartContractRisk: {
    feed: "Protocol TVL 24h",
    icon: "🔐",
    formatValue: (r) => `${r.value >= 0 ? "+" : ""}${r.value.toFixed(2)}%`,
  },
};

/** Oracle feed key for each numeric policy coverage type (index = coverage type id). */
const ORACLE_KEY_BY_COVERAGE_TYPE = [
  "StablecoinDepeg",
  "MarketCrash",
  "LiquidationShield",
  "SmartContractRisk",
  "FlightDelay",
] as const;

export function oracleKeyForCoverageType(coverageType: number): string | null {
  return ORACLE_KEY_BY_COVERAGE_TYPE[coverageType] ?? null;
}

/** Discriminated result of a feed lookup. */
export type OracleFeedLookup =
  | { ok: true; feed: OracleFeedDisplay }
  | { ok: false; reason: "unsupported-pair" };

/**
 * Look up display metadata for an oracle feed key.
 * Returns a typed result so callers can distinguish an unsupported pair from
 * pending/absent data instead of receiving `undefined`.
 */
export function getFeed(key: string | null | undefined): OracleFeedLookup {
  if (!key) return { ok: false, reason: "unsupported-pair" };
  const feed = ORACLE_FEED_DISPLAY[key];
  if (!feed) return { ok: false, reason: "unsupported-pair" };
  return { ok: true, feed };
}

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

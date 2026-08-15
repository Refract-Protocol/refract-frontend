import type { OracleReading } from "@/lib/api/oracle";

/**
 * FIXTURE — not live data.
 *
 * Used as a fallback when GET /api/v1/oracle/status is unreachable, so the
 * landing page's "Live Oracle Status" card still has something plausible to
 * show instead of an empty state. Shape mirrors the real endpoint's
 * response (OracleReading[]) for StablecoinDepeg, MarketCrash, and
 * SmartContractRisk — the same three checks OracleService.checkAll() runs.
 */
export const FIXTURE_ORACLE_READINGS: OracleReading[] = [
  {
    coverageType: "StablecoinDepeg",
    type: "oracle_update",
    value: 1.0002,
    threshold: 0.95,
    severity: "low",
    message: "USDC price: $1.0002 (-0.020% from peg) [CoinGecko]",
  },
  {
    coverageType: "MarketCrash",
    type: "oracle_update",
    value: -1.4,
    threshold: -30,
    severity: "low",
    message: "XLM 24h change: -1.40% (trigger at -30%) [Horizon]",
  },
  {
    coverageType: "SmartContractRisk",
    type: "oracle_update",
    value: -2.1,
    threshold: -50,
    severity: "low",
    message: "Protocol TVL 24h change: -2.10% (trigger at -50%) [DeFiLlama]",
  },
];

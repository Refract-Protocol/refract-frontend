/**
 * Asset definitions for Refract.
 *
 * AssetInfo captures the metadata needed to correctly convert between human-
 * readable amounts and on-chain base units (stroops) for any asset the protocol
 * may support.  Today USDC is the only asset; this module establishes the
 * pattern so future assets can be added here without touching shared utilities.
 */

/** Metadata describing a Stellar/Soroban asset used within the Refract protocol. */
export interface AssetInfo {
  /** Canonical asset code, e.g. "USDC". */
  code: string;
  /**
   * Number of decimal places used by the on-chain base unit.
   * e.g. 7 means 1 human unit = 10^7 base units (stroops).
   */
  decimals: number;
}

/**
 * USDC on Stellar — the sole asset currently supported by Refract.
 * 1 USDC = 10_000_000 base units (7 decimal places).
 */
export const USDC: AssetInfo = {
  code: "USDC",
  decimals: 7,
};

/**
 * Canonical coverage-type presentation metadata.
 *
 * Provenance: the backend catalogue (`GET /api/v1/policies/types`, mirrored by
 * `src/lib/fixtures/coverageTypes.ts`) owns the numeric `coverageType` id and
 * the economic fields (base rate, min/max coverage). This module owns the
 * *presentation* fields — display name, icon, accent colour, risk level and
 * trigger copy — so the four consumers that used to hand-duplicate them
 * (`src/app/page.tsx`, `src/app/cover/page.tsx`, `src/app/dashboard/page.tsx`
 * and the fixture) can never drift apart again.
 *
 * Colours resolve through the design tokens declared in `globals.css` /
 * `tailwind.config.ts` rather than new hex literals.
 */

/** Numeric coverage-type ids the backend currently issues. */
export type CoverageTypeId = 0 | 1 | 2 | 3 | 4;

/** Risk buckets used for tag colouring and heat meters. */
export type CoverageRiskLevel = "low" | "medium" | "high" | "critical";

export interface CoverageMeta {
  /** Stable numeric id matching the backend `coverageType`. */
  id: CoverageTypeId;
  /** Human-readable display name. */
  name: string;
  /** Emoji icon; always rendered `aria-hidden` with `name` carrying the text. */
  icon: string;
  /** Brand accent colour, resolved from design tokens. */
  accentColor: string;
  /** Risk bucket for tag colouring. */
  riskLevel: CoverageRiskLevel;
  /** 0-100 heat value for risk meters. */
  riskHeatPct: number;
  /** Short trigger copy shown on cards. */
  triggerSummary: string;
  /** Oracle source backing the trigger. */
  oracleSource: string;
}

/**
 * Risk-level colours, resolved through the design tokens in `globals.css`.
 * Kept here so every consumer shares one mapping.
 */
export const RISK_LEVEL_COLORS: Record<CoverageRiskLevel, string> = {
  low: "var(--pm-green)",
  medium: "var(--pm-violet)",
  high: "var(--pm-amber)",
  critical: "var(--pm-red)",
};

/**
 * Canonical metadata keyed by the numeric id the backend uses.
 *
 * The `satisfies` clause plus the exhaustiveness check below make adding a new
 * `CoverageTypeId` a compile error until metadata is supplied for it.
 */
export const COVERAGE_META = {
  0: {
    id: 0,
    name: "Flight Delay",
    icon: "✈️",
    accentColor: "var(--pm-violet)",
    riskLevel: "medium",
    riskHeatPct: 45,
    triggerSummary: "Payout if your flight is delayed beyond the threshold.",
    oracleSource: "FlightStats",
  },
  1: {
    id: 1,
    name: "Weather Disruption",
    icon: "🌧️",
    accentColor: "var(--pm-blue)",
    riskLevel: "low",
    riskHeatPct: 20,
    triggerSummary: "Payout on severe weather at your destination.",
    oracleSource: "NOAA",
  },
  2: {
    id: 2,
    name: "Smart Contract Exploit",
    icon: "🛡️",
    accentColor: "var(--pm-red)",
    riskLevel: "critical",
    riskHeatPct: 95,
    triggerSummary: "Payout if a covered protocol is exploited.",
    oracleSource: "On-chain monitor",
  },
  3: {
    id: 3,
    name: "Stablecoin Depeg",
    icon: "🪙",
    accentColor: "var(--pm-amber)",
    riskLevel: "high",
    riskHeatPct: 72,
    triggerSummary: "Payout if a covered stablecoin depegs past the band.",
    oracleSource: "Price feeds",
  },
  4: {
    id: 4,
    name: "Flight Cancellation",
    icon: "🛫",
    accentColor: "var(--pm-green)",
    riskLevel: "medium",
    riskHeatPct: 45,
    triggerSummary: "Payout if your flight is cancelled outright.",
    oracleSource: "FlightStats",
  },
} satisfies Record<CoverageTypeId, CoverageMeta>;

/**
 * Neutral fallback for ids the backend may return outside the known range.
 * Guarantees the UI renders an icon/colour instead of `undefined`.
 */
export const UNKNOWN_COVERAGE_META: CoverageMeta = {
  id: 0,
  name: "Unknown Coverage",
  icon: "❔",
  accentColor: "var(--pm-text-muted)",
  riskLevel: "low",
  riskHeatPct: 0,
  triggerSummary: "Coverage type not recognised by this client.",
  oracleSource: "Unknown",
};

/**
 * Total lookup: never returns `undefined`, even for out-of-range or negative
 * ids the backend might send.
 */
export function coverageMeta(id: number): CoverageMeta {
  return (COVERAGE_META as Record<number, CoverageMeta>)[id] ?? UNKNOWN_COVERAGE_META;
}

/**
 * Compile-time exhaustiveness guard: adding a `CoverageTypeId` without adding
 * metadata fails typecheck here.
 */
type _ExhaustiveCoverageMeta = CoverageTypeId extends keyof typeof COVERAGE_META
  ? true
  : never;
const _exhaustive: _ExhaustiveCoverageMeta = true;
void _exhaustive;

"use client";

import { Navbar, Footer } from "@/components/layout";
import { Container, Card, Badge, Button, Skeleton, StatCardSkeletonGrid, ListRowSkeletons } from "@/components/ui";
import { WalletButton } from "@/components/wallet";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useHolderPolicies } from "@/hooks/useHolderPolicies";
import { useClaims } from "@/hooks/useClaims";
import { usePoolStats } from "@/hooks/usePoolStats";
import { formatUsd, fromStroops } from "@/lib/format";
import { stellarExpertTxUrl } from "@/lib/stellar";
import { aggregateExposure, getPoolRiskAssessment } from "@/lib/portfolioRisk";
import type { Policy } from "@/lib/api/policies";
import type { ClaimRecord } from "@/lib/api/claims";

const COVERAGE_ICONS = ["🪙", "📉", "🛡️", "🔐", "✈️"];
const COVERAGE_COLORS = ["#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#06b6d4"];

type PolicyStatus = "active" | "paid" | "expired";

function policyStatus(policy: Policy, claims: ClaimRecord[]): PolicyStatus {
  const claim = claims.find((c) => c.policyId === policy.id);
  if (claim?.triggered) return "paid";
  return policy.isActive ? "active" : "expired";
}

const STATUS_BADGE: Record<PolicyStatus, { tone: "safe" | "violet" | "neutral"; label: string }> = {
  active: { tone: "safe", label: "Active" },
  paid: { tone: "violet", label: "Paid Out" },
  expired: { tone: "neutral", label: "Expired" },
};

export default function DashboardPage() {
  const wallet = useWallet();
  const address = wallet.status === "connected" ? wallet.address : null;
  const { data: policies, loading, error, isFixture } = useHolderPolicies(address);
  const { data: poolStats } = usePoolStats();
  const claims = useClaims(address, policies);

  const summary = policies
    ? {
        active: policies.filter((p) => policyStatus(p, claims) === "active").length,
        totalCoverage: policies.reduce((sum, p) => sum + fromStroops(p.coverageAmount), 0),
        totalPremiums: policies.reduce((sum, p) => sum + fromStroops(p.premium), 0),
        totalPayouts: claims.filter((c) => c.triggered).reduce((sum, c) => sum + fromStroops(c.payout), 0),
      }
    : null;

  const riskSummary = policies ? aggregateExposure(policies) : null;
  const poolRisk = poolStats ? getPoolRiskAssessment(poolStats.utilizationBps) : null;

  return (
    <div className="min-h-screen bg-pm-bg">
      <Navbar right={<WalletButton />} />

      <main id="main-content">
        <Container className="py-9 sm:py-10">
          <div className="mb-8">
            <h1 className="mb-2 font-display text-[26px] font-extrabold tracking-tight text-pm-text sm:text-[28px]">
              Dashboard
            </h1>
            <p className="text-sm text-pm-text/45">
              Your active policies, claim status, and payout history in one place.
            </p>
            {isFixture && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-pm-amber">
                ⚠ Showing fixture data — either the Refract API isn&apos;t reachable, or it has no
                recorded policies for this address yet.
              </p>
            )}
          </div>

          {!wallet.ready ? (
            <Card padding="lg">
              <Skeleton height={20} width={220} className="mb-3" />
              <Skeleton height={14} width={320} />
            </Card>
          ) : !address ? (
            <Card padding="lg" className="flex flex-col items-center gap-4 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pm-violet/10 text-2xl" aria-hidden="true">
                🔗
              </div>
              <div>
                <h2 className="mb-1.5 font-display text-lg font-bold text-pm-text">Connect your wallet</h2>
                <p className="mx-auto max-w-[360px] text-sm text-pm-text/45">
                  Connect Freighter to see the policies, claim status, and payout history tied to your address.
                </p>
              </div>
              <Button type="button" variant="primary" onClick={() => void wallet.connect()} loading={wallet.status === "connecting"}>
                Connect Wallet
              </Button>
            </Card>
          ) : (
            <>
              {/* Summary */}
              {loading || !summary ? (
                <StatCardSkeletonGrid className="mb-7" ariaLabel="Loading summary statistics" />
              ) : (
                <div className="mb-7 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
                  {[
                    { label: "Active Policies", value: summary.active.toString() },
                    { label: "Total Coverage", value: formatUsd(summary.totalCoverage, { maximumFractionDigits: 0 }) },
                    { label: "Premiums Paid", value: formatUsd(summary.totalPremiums, { maximumFractionDigits: 0 }) },
                    { label: "Total Payouts", value: formatUsd(summary.totalPayouts, { maximumFractionDigits: 0 }), accent: summary.totalPayouts > 0 },
                  ].map((s) => (
                    <Card key={s.label} padding="sm" className="!p-[18px]">
                      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-pm-text/40">{s.label}</div>
                      <div className={`font-display text-[22px] font-extrabold tracking-tight ${s.accent ? "text-pm-green" : "text-pm-text"}`}>
                        {s.value}
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Portfolio Risk Visualization */}
              {!loading && riskSummary && riskSummary.breakdowns.length > 0 && (
                <section aria-labelledby="portfolio-risk-heading" className="mb-8">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 id="portfolio-risk-heading" className="font-display text-lg font-bold tracking-tight text-pm-text">
                      Portfolio Risk &amp; Exposure
                    </h2>
                    {riskSummary.concentrationRisk === "high" && (
                      <Badge tone="risk">High Concentration</Badge>
                    )}
                    {riskSummary.concentrationRisk === "medium" && (
                      <Badge tone="violet">Balanced Exposure</Badge>
                    )}
                    {riskSummary.concentrationRisk === "low" && (
                      <Badge tone="safe">Diversified</Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
                    {/* Category Breakdown Bar & Details */}
                    <Card padding="md">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-pm-text">Exposure Distribution</span>
                        <span className="text-xs text-pm-text/45">
                          {formatUsd(riskSummary.totalExposure)} Total
                        </span>
                      </div>

                      {/* Multi-segment proportional bar */}
                      <div className="mb-5 flex h-3.5 w-full overflow-hidden rounded-full bg-white/[0.04] p-0.5 border border-white/[0.06]">
                        {riskSummary.breakdowns.map((seg) => (
                          <div
                            key={seg.coverageType}
                            style={{
                              width: `${seg.percentageOfTotal}%`,
                              backgroundColor: seg.color,
                            }}
                            className="h-full first:rounded-l-full last:rounded-r-full transition-all duration-500"
                            title={`${seg.coverageTypeName}: ${seg.percentageOfTotal}% (${formatUsd(seg.totalAmount)})`}
                          />
                        ))}
                      </div>

                      {/* List of categories */}
                      <div className="flex flex-col gap-2.5">
                        {riskSummary.breakdowns.map((seg) => (
                          <div
                            key={seg.coverageType}
                            className="flex items-center justify-between rounded-lg border border-white/[0.03] bg-white/[0.015] px-3 py-2 text-xs"
                          >
                            <div className="flex items-center gap-2.5">
                              <span
                                className="flex h-6 w-6 items-center justify-center rounded-md text-xs"
                                style={{ background: `${seg.color}20` }}
                                aria-hidden="true"
                              >
                                {seg.icon}
                              </span>
                              <div>
                                <span className="font-semibold text-pm-text">{seg.coverageTypeName}</span>
                                <span className="ml-2 text-[10px] text-pm-text/40">
                                  ({seg.policyCount} {seg.policyCount === 1 ? "policy" : "policies"})
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-medium text-pm-text">{formatUsd(seg.totalAmount)}</span>
                              <span
                                className="w-12 text-right font-bold text-xs"
                                style={{ color: seg.color }}
                              >
                                {seg.percentageOfTotal}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>

                    {/* Risk Scenario & Pool Capacity Cross-reference */}
                    <div className="flex flex-col gap-4">
                      {/* Projected Trigger Payout Scenario */}
                      {riskSummary.maxSingleCategory && (
                        <Card padding="md" className="border-pm-violet/20 bg-pm-violet/[0.04]">
                          <div className="mb-2 text-[11px] uppercase tracking-wide text-pm-text/40">
                            Trigger Scenario Simulation
                          </div>
                          <div className="mb-2 text-sm font-semibold text-pm-text">
                            If <span className="text-pm-violet">{riskSummary.maxSingleCategory.coverageTypeName}</span> fires today:
                          </div>
                          <div className="font-display text-2xl font-extrabold text-pm-green">
                            {formatUsd(riskSummary.maxSingleCategory.totalAmount)} USDC
                          </div>
                          <p className="mt-1 text-[11px] text-pm-text/40">
                            Automatic oracle settlement within ~5 seconds directly to your wallet.
                          </p>
                        </Card>
                      )}

                      {/* Pool Utilization Banner */}
                      {poolRisk && (
                        <Card padding="md" className="border-white/[0.06]">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-[11px] uppercase tracking-wide text-pm-text/40">
                              Underwriting Pool Status
                            </span>
                            <span className="text-xs font-bold text-pm-violet">
                              {poolRisk.utilizationPct.toFixed(1)}% Utilized
                            </span>
                          </div>
                          <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-pm-green via-pm-violet to-pm-amber"
                              style={{ width: `${Math.min(100, poolRisk.utilizationPct)}%` }}
                            />
                          </div>
                          <div className="text-xs font-semibold text-pm-text mb-0.5">{poolRisk.title}</div>
                          <p className="text-[11px] leading-relaxed text-pm-text/45">{poolRisk.message}</p>
                        </Card>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* Policies */}
              <section aria-labelledby="policies-heading" className="mb-8">
                <h2 id="policies-heading" className="mb-4 font-display text-lg font-bold tracking-tight text-pm-text">
                  Your Policies
                </h2>

                {error && (
                  <Card className="border-pm-red/30 !bg-pm-red/[0.04]">
                    <p className="text-sm text-pm-red">Couldn&apos;t load policies: {error}</p>
                  </Card>
                )}

                {loading && (
                  <ListRowSkeletons count={3} height={84} ariaLabel="Loading policies" className="gap-3" />
                )}

                {!loading && policies && policies.length === 0 && (
                  <Card className="py-12 text-center">
                    <p className="text-sm text-pm-text/45">No policies yet. Get covered to see it here.</p>
                    <Button href="/cover" variant="outline" className="mt-4 inline-flex">
                      Browse coverage
                    </Button>
                  </Card>
                )}

                {!loading && policies && policies.length > 0 && (
                  <div className="flex flex-col gap-3">
                    {policies.map((policy) => {
                      const status = policyStatus(policy, claims);
                      const badge = STATUS_BADGE[status];
                      return (
                        <Card key={policy.id} padding="md" className="!py-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-3.5">
                              <span
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg"
                                style={{ background: `${COVERAGE_COLORS[policy.coverageType]}18` }}
                                aria-hidden="true"
                              >
                                {COVERAGE_ICONS[policy.coverageType]}
                              </span>
                              <div>
                                <div className="mb-0.5 flex items-center gap-2">
                                  <span className="text-sm font-semibold text-pm-text">{policy.coverageTypeName}</span>
                                  <Badge tone={badge.tone}>{badge.label}</Badge>
                                </div>
                                <div className="font-mono text-[11px] text-pm-text/35">{policy.id}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-6 sm:justify-end">
                              <div className="text-right">
                                <div className="text-[11px] uppercase tracking-wide text-pm-text/35">Coverage</div>
                                <div className="text-sm font-semibold text-pm-text">{formatUsd(fromStroops(policy.coverageAmount))}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-[11px] uppercase tracking-wide text-pm-text/35">
                                  {status === "expired" || status === "paid" ? "Expired" : "Expires"}
                                </div>
                                <div className="text-sm font-semibold text-pm-text">
                                  {new Date(policy.expiresAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                </div>
                              </div>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Claims / payout history */}
              <section aria-labelledby="claims-heading">
                <h2 id="claims-heading" className="mb-4 font-display text-lg font-bold tracking-tight text-pm-text">
                  Claim &amp; Payout History
                </h2>

                {!loading && claims.length === 0 && (
                  <Card className="py-12 text-center">
                    <p className="text-sm text-pm-text/45">No claims triggered yet — no news is good news.</p>
                  </Card>
                )}

                {claims.length > 0 && (
                  <div className="flex flex-col gap-3">
                    {claims.map((claim) => (
                      <Card key={claim.policyId} padding="md" className="!py-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-3.5">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pm-green/10 text-lg" aria-hidden="true">
                              💰
                            </span>
                            <div>
                              <div className="mb-0.5 text-sm font-semibold text-pm-text">
                                {new Date(claim.processedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                              </div>
                              <div className="text-xs text-pm-text/45">{claim.reason}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-display text-lg font-extrabold text-pm-green">{formatUsd(fromStroops(claim.payout))}</div>
                            <div className="font-mono text-[11px] text-pm-text/35">{claim.policyId}</div>
                            {claim.settlementTxHash && (
                              <a
                                href={stellarExpertTxUrl(claim.settlementTxHash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-pm-text/45 underline decoration-pm-text/20 underline-offset-2 transition-colors hover:text-pm-text/70"
                              >
                                View transaction
                                <span className="sr-only"> (opens in a new tab)</span>
                              </a>
                            )}
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </Container>
      </main>

      <Footer />
    </div>
  );
}

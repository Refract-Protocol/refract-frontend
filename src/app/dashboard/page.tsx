"use client";

import { Navbar, Footer } from "@/components/layout";
import { Container, Card, Badge, Button, Skeleton } from "@/components/ui";
import { WalletButton } from "@/components/wallet";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useHolderPolicies } from "@/hooks/useHolderPolicies";
import { useClaims } from "@/hooks/useClaims";
import { usePagination } from "@/hooks/usePagination";
import { formatUsd, fromStroops } from "@/lib/format";
import { stellarExpertTxUrl } from "@/lib/stellar";
import { getCoverageIcon, getCoverageColor } from "@/lib/coverage/metadata";
import type { Policy } from "@/lib/api/policies";
import type { ClaimRecord } from "@/lib/api/claims";

const COVERAGE_ICONS = ["🪙", "📉", "🛡️", "🔐", "✈️"];
const COVERAGE_COLORS = ["#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#06b6d4"];
const PAGE_SIZE = 10;

type PolicyStatus = "active" | "paid" | "expired";

function policyStatus(policy: Policy, claims: ClaimRecord[], claimsLoading: boolean): PolicyStatus {
  const claim = claims.find((c) => c.policyId === policy.id);
  if (claim?.triggered) return "paid";
  if (claimsLoading) return policy.isActive ? "active" : "expired";
  return policy.isActive ? "active" : "expired";
}

const STATUS_BADGE: Record<PolicyStatus, { tone: "safe" | "violet" | "neutral"; label: string }> = {
  active: { tone: "safe"
type PolicyStatus = "active" | "paid" | "expired";

function policyStatus(policy: Policy, claims: ClaimRecord[], claimsLoading: boolean): PolicyStatus {
  const claim = claims.find((c) => c.policyId === policy.id);
  if (claim?.triggered) return "paid";
  if (claimsLoading) return policy.isActive ? "active" : "expired";
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
  const { data: policies, loading, error, source } = useHolderPolicies(address);
  const { data: claims, loading: claimsLoading, error: claimsError } = useClaims(address, policies);

  const policyList = policies ?? [];
  const claimList = claims ?? [];
  const policiesPagination = usePagination(policyList, PAGE_SIZE);
  const claimsPagination = usePagination(claimList, PAGE_SIZE);

  const summary = policies
    ? {
        active: policies.filter((p) => policyStatus(p, claims, claimsLoading) === "active").length,
        totalCoverage: policies.reduce((sum, p) => sum + fromStroops(p.coverageAmount), 0),
        totalPremiums: policies.reduce((sum, p) => sum + fromStroops(p.premium), 0),
        totalPayouts: claims.filter((c) => c.triggered).reduce((sum, c) => sum + fromStroops(c.payout), 0),
      }
    : null;

  const summaryLoading = loading || claimsLoading || !summary;

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
            {source === "fixture-unreachable" && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-pm-amber">
                ⚠ Showing fixture data — the Refract API isn&apos;t reachable right now.
              </p>
            )}
            {source === "fixture-demo" && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-pm-amber">
                ⚠ Showing demo fixture data — demo mode is enabled for this address.
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
              <div className="mb-7 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
                {summaryLoading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <Card key={i} padding="sm" className="!p-[18px]">
                        <Skeleton height={11} width={70} className="mb-2.5" />
                        <Skeleton height={22} width={90} />
                      </Card>
                    ))
                  : [
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
                  <div className="flex flex-col gap-3" role="status" aria-label="Loading policies">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} height={84} rounded="md" />
                    ))}
                  </div>
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
                    {policiesPagination.visible.map((policy) => {
                      const status = policyStatus(policy, claims, claimsLoading);
                      const badge = STATUS_BADGE[status];
                      return (
                        <Card key={policy.id} padding="md" className="!py-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-3.5">
                              <span
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg"
                                style={{ background: `${getCoverageColor(policy.coverageType)}18` }}
                                aria-hidden="true"
                              >
                                {getCoverageIcon(policy.coverageType)}
                              </span>
                              <div>
                                <div className="mb-0.5 font-display text-[15px] font-bold text-pm-text">
                                  {policy.coverageTypeName}
                                </div>
                                <div className="text-xs text-pm-text/40">
                                  {formatUsd(fromStroops(policy.coverageAmount), { maximumFractionDigits: 0 })} coverage
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-pm-text/45">
                              <span>Premium {formatUsd(fromStroops(policy.premium), { maximumFractionDigits: 0 })}</span>
                              {policy.txHash && (
                                <a
                                  href={stellarExpertTxUrl(policy.txHash)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-pm-violet hover:underline"
                                >
                                  View tx
                                </a>
                              )}
                              <Button href={`/dashboard/policies/${policy.id}`} variant="outline" className="inline-flex">
                                View details
                              </Button>
                            </div>
                          </div>
                        </Card>
                      );
                    })}

                    <div className="mt-1 flex flex-col items-center gap-2">
                      <p className="text-xs text-pm-text/40" aria-live="polite">
                        Showing {policiesPagination.visible.length} of {policiesPagination.total} policies
                      </p>
                      {policiesPagination.hasMore && (
                        <Button type="button" variant="outline" onClick={policiesPagination.loadMore}>
                          Load more policies
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </section>

              {/* Claims */}
              <section aria-labelledby="claims-heading">
                <h2 id="claims-heading" className="mb-4 font-display text-lg font-bold tracking-tight text-pm-text">
                  Claim History
                </h2>

                {claimsError && (
                  <Card className="border-pm-red/30 !bg-pm-red/[0.04]">
                    <p className="text-sm text-pm-red">Couldn&apos;t load claims: {claimsError}</p>
                  </Card>
                )}

                {claimsLoading && (
                  <div className="flex flex-col gap-3" role="status" aria-label="Loading claims">
                    {Array.from({ length: 2 }).map((_, i) => (
                      <Skeleton key={i} height={72} rounded="md" />
                    ))}
                  </div>
                )}

                {!claimsLoading && claimList.length === 0 && (
                  <Card className="py-12 text-center">
                    <p className="text-sm text-pm-text/45">No claims filed yet.</p>
                  </Card>
                )}

                {!claimsLoading && claimList.length > 0 && (
                  <div className="flex flex-col gap-3">
                    {claimsPagination.visible.map((claim) => (
                      <Card key={claim.id} padding="md" className="!py-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="mb-0.5 flex items-center gap-2">
                              <span className="text-sm font-semibold text-pm-text">
                                Claim #{claim.id}
                              </span>
                              <Badge tone={claim.triggered ? "violet" : "neutral"}>
                                {claim.triggered ? "Paid Out" : "Pending"}
                              </Badge>
                            </div>
                            <div className="text-xs text-pm-text/40">
                              Policy #{claim.policyId}
                              {claim.txHash && (
                                <>
                                  {" · "}
                                  <a
                                    href={stellarExpertTxUrl(claim.txHash)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-pm-violet hover:underline"
                                  >
                                    View transaction
                                  </a>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[11px] uppercase tracking-wide text-pm-text/40">Payout</div>
                            <div className="text-sm font-semibold text-pm-text">
                              {formatUsd(fromStroops(claim.payout), { maximumFractionDigits: 2 })}
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}

                    <div className="mt-1 flex flex-col items-center gap-2">
                      <p className="text-xs text-pm-text/40" aria-live="polite">
                        Showing {claimsPagination.visible.length} of {claimsPagination.total} claims
                      </p>
                      {claimsPagination.hasMore && (
                        <Button type="button" variant="outline" onClick={claimsPagination.loadMore}>
                          Load more claims
                        </Button>
                      )}
                    </div>
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

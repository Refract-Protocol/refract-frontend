"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Navbar, Footer } from "@/components/layout";
import { Container, Card, Badge, Button, Input, Skeleton, ListRowSkeletons } from "@/components/ui";
import { WalletButton } from "@/components/wallet";
import { useCoverageTypes } from "@/hooks/useCoverageTypes";
import { useCoverageBounds } from "@/hooks/useCoverageBounds";
import { calculatePremium, getEffectiveMaxCoverage, getEffectiveMinCoverage, toggleCoverageSelection } from "@/lib/premium";
import { formatUsd } from "@/lib/format";

const RISK_TAG_COLORS: Record<string, string> = {
  low: "#10b981",
  medium: "#8b5cf6",
  high: "#f59e0b",
  critical: "#ef4444",
};

const RISK_HEAT: Record<string, number> = { low: 20, medium: 45, high: 72, critical: 95 };

const QUICK_AMOUNTS = [1_000, 5_000, 10_000, 25_000];

export default function CoverComparePage() {
  const router = useRouter();
  const { data: coverageTypes, loading: typesLoading, error: typesError, isFixture } = useCoverageTypes();
  const { minCoverage: chainMinCoverage, maxCoverage: chainMaxCoverage } = useCoverageBounds();

  // Default to comparing first 3 coverage types
  const [selectedTypeIds, setSelectedTypeIds] = useState<number[]>([0, 1, 2]);
  const [coverageAmount, setCoverageAmount] = useState("5000");
  const [durationDays, setDurationDays] = useState(30);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);

  const effectiveMin = getEffectiveMinCoverage(chainMinCoverage);
  const parsedAmount = parseFloat(coverageAmount || "0");

  const expiryDate = useMemo(() => {
    return new Date(Date.now() + durationDays * 86400000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [durationDays]);

  const selectedTypes = useMemo(() => {
    if (!coverageTypes) return [];
    return coverageTypes.filter((t) => selectedTypeIds.includes(t.id));
  }, [coverageTypes, selectedTypeIds]);

  const handleToggleType = (typeId: number) => {
    const { selected, error } = toggleCoverageSelection(selectedTypeIds, typeId, 2, 4);
    if (error) {
      setSelectionNotice(error);
      setTimeout(() => setSelectionNotice(null), 3000);
    } else {
      setSelectedTypeIds(selected);
      setSelectionNotice(null);
    }
  };

  const handleSelectToBuy = (typeId: number) => {
    const params = new URLSearchParams({
      type: String(typeId),
      amount: coverageAmount,
      duration: String(durationDays),
    });
    router.push(`/cover?${params.toString()}`);
  };

  return (
    <div className="min-h-screen bg-pm-bg">
      <Navbar right={<WalletButton />} />

      <main id="main-content">
        <Container className="py-9 sm:py-10">
          {/* Header */}
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Link
                  href="/cover"
                  className="text-xs font-semibold text-pm-violet hover:underline inline-flex items-center gap-1"
                >
                  ← Back to Single Quote
                </Link>
              </div>
              <h1 className="mb-2 font-display text-[26px] font-extrabold tracking-tight text-pm-text sm:text-[28px]">
                Compare Coverage Plans
              </h1>
              <p className="text-sm text-pm-text/45">
                Compare rates, trigger criteria, risk levels, and premiums across 2–4 coverage types side-by-side.
              </p>
              {isFixture && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-pm-amber">
                  ⚠ Showing fixture data — the Refract API isn&apos;t reachable from this environment.
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Link href="/cover">
                <Button variant="outline" size="sm">
                  Single Quote View
                </Button>
              </Link>
            </div>
          </div>

          {/* Controls Bar: Type selector & parameters */}
          <Card padding="md" className="mb-8">
            <div className="flex flex-col gap-6">
              {/* Coverage Type Toggles (Select 2-4) */}
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wide text-pm-text/40">
                    Select 2 to 4 types to compare ({selectedTypeIds.length} selected)
                  </span>
                  {selectionNotice && (
                    <span className="text-xs text-pm-amber font-medium animate-pulse">{selectionNotice}</span>
                  )}
                </div>

                {typesLoading && (
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} height={44} rounded="md" />
                    ))}
                  </div>
                )}

                {typesError && (
                  <p className="text-sm text-pm-red">Couldn&apos;t load coverage types: {typesError}</p>
                )}

                {coverageTypes && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                    {coverageTypes.map((type) => {
                      const isSelected = selectedTypeIds.includes(type.id);
                      return (
                        <button
                          key={type.id}
                          type="button"
                          onClick={() => handleToggleType(type.id)}
                          aria-pressed={isSelected}
                          className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-all ${
                            isSelected
                              ? "border-pm-violet/60 bg-pm-violet/15 text-pm-text shadow-[0_0_12px_rgba(139,92,246,0.2)]"
                              : "border-white/[0.06] bg-white/[0.02] text-pm-text/50 hover:bg-white/[0.05] hover:text-pm-text"
                          }`}
                        >
                          <span className="text-lg" aria-hidden="true">{type.icon}</span>
                          <div className="truncate">
                            <div className="text-xs font-semibold truncate">{type.name}</div>
                            <div className="text-[10px] text-pm-text/40">{type.baseRatePct}%/yr</div>
                          </div>
                          <span className="ml-auto text-xs font-bold text-pm-violet">
                            {isSelected ? "✓" : "+"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Shared parameters: Amount & Duration */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/[0.06]">
                {/* Amount */}
                <div>
                  <Input
                    label="Comparison Coverage Amount (USDC)"
                    type="number"
                    inputMode="decimal"
                    value={coverageAmount}
                    onChange={(e) => setCoverageAmount(e.target.value)}
                    placeholder="5000"
                    min={effectiveMin}
                  />
                  <div className="mt-2 flex gap-1.5">
                    {QUICK_AMOUNTS.map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setCoverageAmount(String(v))}
                        className="flex-1 rounded border border-pm-violet/15 bg-pm-violet/[0.08] py-1 text-[11px] text-pm-violet hover:bg-pm-violet/20"
                      >
                        ${v.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Duration */}
                <div>
                  <div className="mb-2 flex justify-between">
                    <label htmlFor="compare-duration" className="text-xs text-pm-text/60">
                      Coverage Duration
                    </label>
                    <span className="text-[13px] font-bold text-pm-violet">
                      {durationDays} days · Expires {expiryDate}
                    </span>
                  </div>
                  <input
                    id="compare-duration"
                    type="range"
                    min={1}
                    max={365}
                    value={durationDays}
                    onChange={(e) => setDurationDays(Number(e.target.value))}
                    aria-valuetext={`${durationDays} days, expires ${expiryDate}`}
                    className="pm-slider"
                    style={{ "--pct": `${(durationDays / 365) * 100}%` } as React.CSSProperties}
                  />
                  <div className="mt-1 flex justify-between">
                    <span className="text-[10px] text-pm-text/30">1 day</span>
                    <span className="text-[10px] text-pm-text/30">1 year (365 days)</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Comparison Grid */}
          {typesLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} padding="md">
                  <Skeleton height={380} rounded="md" />
                </Card>
              ))}
            </div>
          ) : (
            <div
              className={`grid grid-cols-1 gap-6 ${
                selectedTypes.length === 2
                  ? "md:grid-cols-2 max-w-4xl mx-auto"
                  : selectedTypes.length === 3
                    ? "md:grid-cols-3"
                    : "md:grid-cols-2 lg:grid-cols-4"
              }`}
            >
              {selectedTypes.map((type) => {
                const effectiveMax = getEffectiveMaxCoverage(type.maxCoverage, chainMaxCoverage);
                const isAmountClamped = parsedAmount > effectiveMax;
                const activeAmount = isAmountClamped ? effectiveMax : parsedAmount;
                const premium = calculatePremium(activeAmount, type.baseRatePct, durationDays);
                const isAmountInvalid = parsedAmount < effectiveMin;

                return (
                  <Card
                    key={type.id}
                    padding="md"
                    className="flex flex-col justify-between border-white/[0.08] hover:border-pm-violet/30 transition-all"
                  >
                    <div>
                      {/* Card Header */}
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="text-3xl" aria-hidden="true">{type.icon}</span>
                          <div>
                            <h2 className="text-base font-bold text-pm-text">{type.name}</h2>
                            <span
                              className="text-[11px] font-semibold uppercase tracking-wider"
                              style={{ color: RISK_TAG_COLORS[type.riskLevel] }}
                            >
                              {type.riskLevel} Risk
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Risk Heat Bar */}
                      <div className="mb-5">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${RISK_HEAT[type.riskLevel]}%`,
                              background: `linear-gradient(90deg,#10b981,${RISK_TAG_COLORS[type.riskLevel]})`,
                            }}
                          />
                        </div>
                      </div>

                      {/* Premium Box */}
                      <div className="mb-5 rounded-lg border border-pm-violet/20 bg-pm-violet/[0.08] p-4 text-center">
                        <div className="text-[11px] uppercase tracking-wide text-pm-text/50 mb-1">
                          Calculated Premium
                        </div>
                        <div className="font-display text-2xl font-black text-pm-violet">
                          {formatUsd(premium)}
                        </div>
                        <div className="mt-1 text-[11px] text-pm-text/40">
                          for {durationDays} days @ {type.baseRatePct}%/yr
                        </div>
                      </div>

                      {/* Details List */}
                      <dl className="mb-6 flex flex-col gap-3 text-xs">
                        <div className="flex justify-between border-b border-white/[0.04] pb-2">
                          <dt className="text-pm-text/45">Effective Coverage</dt>
                          <dd className="font-semibold text-pm-text">
                            {formatUsd(activeAmount)}
                            {isAmountClamped && (
                              <span className="block text-[10px] text-pm-amber">
                                (Max clamped to ${effectiveMax.toLocaleString()})
                              </span>
                            )}
                          </dd>
                        </div>

                        <div className="flex justify-between border-b border-white/[0.04] pb-2">
                          <dt className="text-pm-text/45">Annual Base Rate</dt>
                          <dd className="font-semibold text-pm-violet">{type.baseRatePct}%</dd>
                        </div>

                        <div className="flex justify-between border-b border-white/[0.04] pb-2">
                          <dt className="text-pm-text/45">Pool Max Limit</dt>
                          <dd className="font-medium text-pm-text">${effectiveMax.toLocaleString()} USDC</dd>
                        </div>

                        <div className="flex flex-col gap-1 border-b border-white/[0.04] pb-2">
                          <dt className="text-pm-text/45">Trigger Condition</dt>
                          <dd className="text-pm-text/80 text-[11px] leading-relaxed font-medium">
                            {type.trigger}
                          </dd>
                        </div>

                        <div className="flex flex-col gap-1">
                          <dt className="text-pm-text/45">Description</dt>
                          <dd className="text-pm-text/60 text-[11px] leading-relaxed">
                            {type.description}
                          </dd>
                        </div>
                      </dl>

                      <div className="mb-6 flex flex-wrap gap-1.5">
                        <Badge tone="violet">Auto-settle</Badge>
                        <Badge tone="safe">On-chain</Badge>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div>
                      <Button
                        type="button"
                        variant="primary"
                        block
                        size="md"
                        disabled={isAmountInvalid}
                        onClick={() => handleSelectToBuy(type.id)}
                      >
                        Buy {type.name}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </Container>
      </main>

      <Footer />
    </div>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import { Navbar, Footer } from "@/components/layout";
import { Container, Card, Badge, Input, Button, Skeleton } from "@/components/ui";
import { WalletButton } from "@/components/wallet";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useCoverageTypes } from "@/hooks/useCoverageTypes";
import { useCoverageBounds } from "@/hooks/useCoverageBounds";
import { usePoolStats } from "@/hooks/usePoolStats";
import { computePoolCapacity } from "@/lib/pool/capacity";
import { buyPolicy, type BuyPolicyResponse } from "@/lib/api/policies";
import { ApiUnreachableError } from "@/lib/api/client";
import { formatUsd, toStroops } from "@/lib/format";
import { truncateAddress } from "@/lib/wallet/WalletProvider";
import { signAndSubmit } from "@/lib/wallet/signAndSubmit";

const RISK_TAG_COLORS: Record<string, string> = {
  low: "#10b981",
  medium: "#8b5cf6",
  high: "#f59e0b",
  critical: "#ef4444",
};

const RISK_HEAT: Record<string, number> = { low: 20, medium: 45, high: 72, critical: 95 };

const QUICK_AMOUNTS = [1_000, 5_000, 10_000, 25_000];

export default function CoverPage() {
  const wallet = useWallet();
  const { data: coverageTypes, loading: typesLoading, error: typesError, isFixture } = useCoverageTypes();
  const { minCoverage: chainMinCoverage, maxCoverage: chainMaxCoverage } = useCoverageBounds();
  const { data: poolStats, loading: poolLoading, error: poolError, isFixture: poolIsFixture } = usePoolStats();

  const [selectedType, setSelectedType] = useState(0);
  const [coverageAmount, setCoverageAmount] = useState("5000");
  const [durationDays, setDurationDays] = useState(30);
  const [flightNumber, setFlightNumber] = useState("");
  const [submission, setSubmission] = useState<
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "signing" }
    | { status: "success"; result: BuyPolicyResponse; demo: boolean; txHash?: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const radioRefs = useRef<Record<number, HTMLButtonElement | null>>({});

  const ct = coverageTypes?.[selectedType];

  const premium = useMemo(() => {
    if (!ct) return 0;
    const amount = parseFloat(coverageAmount) || 0;
    const annualRate = ct.baseRatePct / 100;
    return amount * annualRate * (durationDays / 365);
  }, [coverageAmount, durationDays, ct]);

  const expiryDate = new Date(Date.now() + durationDays * 86400000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // The pool enforces one real global bound across every coverage type,
  // which can be tighter than a given type's advertised catalog max (see
  // PolicyService.onChainCoverageBounds' doc comment in the backend) —
  // clamp against both so this can't approve an amount the pool would
  // actually reject. A third constraint is the pool's own free capital:
  // even a catalogue-legal amount can exceed what the pool can currently
  // back, so we also cap against the writable capacity derived from live
  // pool stats (respecting maxUtilizationBps).
  const effectiveMin = Math.max(100, chainMinCoverage ?? 0);
  const catalogueMax = ct ? Math.min(ct.maxCoverage, chainMaxCoverage ?? ct.maxCoverage) : 0;

  // Fixture-derived stats must not be presented as a verified capacity limit.
  const capacityVerified = !!poolStats && !poolIsFixture;
  const capacity = useMemo(
    () => (capacityVerified && poolStats ? computePoolCapacity(poolStats) : null),
    [capacityVerified, poolStats],
  );

  const effectiveMax = capacity ? Math.min(catalogueMax, capacity.maxCoverage) : catalogueMax;

  const amount = parseFloat(coverageAmount || "0");
  const amountInvalid = ct ? amount < effectiveMin || amount > effectiveMax : false;

  // Name the binding constraint so the buyer knows what to change.
  const amountError = useMemo(() => {
    if (!ct || !amountInvalid) return null;
    if (amount < effectiveMin) return `Minimum coverage is ${formatUsd(effectiveMin)}.`;
    if (capacity && capacity.exhausted) {
      return "Coverage is temporarily unavailable — the pool has no free capacity right now.";
    }
    if (capacity && capacity.maxCoverage < catalogueMax) {
      return `The pool can currently back up to ${formatUsd(capacity.maxCoverage)} of coverage. Try a smaller amount.`;
    }
    return `Maximum coverage for this type is ${formatUsd(catalogueMax)}.`;
  }, [ct, amountInvalid, amount, effectiveMin, capacity, catalogueMax]);

  const isFlightDelay = ct?.id === 4;
  const flightNumberInvalid = isFlightDelay && flightNumber.trim().length === 0;

  async function handleBuy() {
    if (!ct) return;
    if (wallet.status !== "connected" || !wallet.address) {
      await wallet.connect();
      return;
    }
    if (amountInvalid || flightNumberInvalid) return;

    // Capacity can change between page load and submit — re-check against
    // the freshest stats before building the transaction.
    if (capacityVerified && poolStats) {
      const fresh = computePoolCapacity(poolStats);
      if (amount > fresh.maxCoverage) {
        setSubmission({
          status: "error",
          message: fresh.exhausted
            ? "Coverage is temporarily unavailable — the pool has no free capacity right now."
            : `The pool can currently back up to ${formatUsd(fresh.maxCoverage)} of coverage. Try a smaller amount.`,
        });
        return;
      }
    }

    setSubmission({ status: "submitting" });
    try {
      const result = await buyPolicy({
        holder: wallet.address,
        coverageType: ct.id,
        coverageAmount: toStroops(parseFloat(coverageAmount)),
        durationDays,
        ...(isFlightDelay ? { triggerParams: { flightNumber: flightNumber.trim() } } : {}),
      });

      setSubmission({ status: "signing" });
      if (!wallet.networkPassphrase) {
        throw new Error("Wallet network isn't available — reconnect and try again");
      }
      const txHash = await signAndSubmit(result.txXdr, wallet.address, wallet.networkPassphrase);
      setSubmission({ status: "success", result, demo: false, txHash });
    } catch (err) {
      if (err instanceof ApiUnreachableError) {
        // Backend isn't reachable in this environment — fall back to a
        // clearly-labeled client-side simulation so the flow can still be
        // demoed end-to-end. Nothing here is presented as a real payout.
        const demoResult: BuyPolicyResponse = {
          policy: {
            id: `demo-${crypto.randomUUID()}`,
            holder: wallet.address,
            coverageType: ct.id,
            coverageTypeName: ct.name,
            coverageAmount: toStroops(parseFloat(coverageAmount)),
            premium: toStroops(premium),
            durationDays,
            expiresAt: Math.floor(Date.now() / 1000) + durationDays * 86400,
            isActive: true,
            createdAt: new Date().toISOString(),
          },
          txXdr: "DEMO_MODE — backend unreachable, no transaction was built",
          message: "Simulated locally: the Refract API is not running in this environment.",
        };
        setSubmission({ status: "success", result: demoResult, demo: true });
        return;
      }
      setSubmission({
        status: "error",
        message: err instanceof Error ? err.message : "Something went wrong buying coverage",
      });
    }
  }

  return (
    <div className="min-h-screen bg-pm-bg">
      <Navbar right={<WalletButton />} />

      <main id="main-content">
        <Container className="py-9 sm:py-10">
          <div className="mb-8">
            <h1 className="mb-2 font-display text-[26px] font-extrabold tracking-tight text-pm-text sm:text-[28px]">
              Get Coverage
            </h1>
            <p className="text-sm text-pm-text/45">
              Choose your coverage type, set amount and duration. Premium paid once. Payout automatic.
            </p>
            {isFixture && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-pm-amber">
                ⚠ Showing fixture data — the Refract API isn&apos;t reachable from this environment.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_360px]">
            {/* Left: Coverage type selector + config */}
            <div className="flex flex-col gap-5">
              <div>
                <div className="mb-3 text-[11px] uppercase tracking-wide text-pm-text/40">1. Select Coverage Type</div>

                {typesError && (
                  <Card className="border-pm-red/30 !bg-pm-red/[0.04]">
                    <p className="text-sm text-pm-red">Couldn&apos;t load coverage types: {typesError}</p>
                  </Card>
                )}

                {typesLoading && (
                  <div className="flex flex-col gap-2.5" role="status" aria-label="Loading coverage types">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} height={72} rounded="md" />
                    ))}
                  </div>
                )}

                {coverageTypes && (
                  <div
                    className="flex flex-col gap-2.5"
                    role="radiogroup"
                    aria-label="Coverage type"
                    onKeyDown={(e) => {
                      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
                      e.preventDefault();
                      const ids = coverageTypes.map((t) => t.id);
                      const currentIndex = ids.indexOf(selectedType);
                      let nextIndex = currentIndex;
                      if (e.key === "ArrowDown") nextIndex = (currentIndex + 1) % ids.length;
                      if (e.key === "ArrowUp") nextIndex = (currentIndex - 1 + ids.length) % ids.length;
                      if (e.key === "Home") nextIndex = 0;
                      if (e.key === "End") nextIndex = ids.length - 1;
                      const nextId = ids[nextIndex];
                      setSelectedType(nextId);
                      radioRefs.current[nextId]?.focus();
                    }}
                  >
                    {coverageTypes.map((type) => {
                      const selected = type.id === selectedType;
                      return (
                        <button
                          key={type.id}
                          ref={(el) => {
                            radioRefs.current[type.id] = el;
                          }}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          tabIndex={selected ? 0 : -1}
                          onClick={() => setSelectedType(type.id)}
                          className={`flex items-center gap-3.5 rounded-xl border p-3.5 text-left transition-colors ${
                            selected
                              ? "border-pm-violet/50 bg-pm-violet/[0.08]"
                              : "border-pm-border bg-pm-surface hover:border-pm-border/80"
                          }`}
                        >
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                            style={{
                              background: `${RISK_TAG_COLORS[type.riskLevel] ?? "#8b5cf6"}22`,
                              color: RISK_TAG_COLORS[type.riskLevel] ?? "#8b5cf6",
                            }}
                          >
                            {type.name.slice(0, 1)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold text-pm-text">{type.name}</span>
                              <Badge color={RISK_TAG_COLORS[type.riskLevel] ?? "#8b5cf6"}>
                                {type.riskLevel}
                              </Badge>
                            </div>
                            <div className="mt-0.5 text-[11px] text-pm-text/40">
                              {type.baseRatePct}% annual · up to {formatUsd(type.maxCoverage)}
                            </div>
                          </div>
                          <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-pm-border sm:block">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${RISK_HEAT[type.riskLevel] ?? 50}%`,
                                background: RISK_TAG_COLORS[type.riskLevel] ?? "#8b5cf6",
                              }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {ct && (
                <Card>
                  <div className="mb-3 text-[11px] uppercase tracking-wide text-pm-text/40">2. Configure</div>

                  <label className="mb-1.5 block text-xs font-medium text-pm-text/60" htmlFor="coverage-amount">
                    Coverage amount (USDC)
                  </label>
                  <Input
                    id="coverage-amount"
                    type="number"
                    min={effectiveMin}
                    max={effectiveMax}
                    value={coverageAmount}
                    onChange={(e) => setCoverageAmount(e.target.value)}
                    aria-invalid={amountInvalid}
                    aria-describedby={amountError ? "coverage-amount-error" : undefined}
                  />
                  {amountError && (
                    <p id="coverage-amount-error" className="mt-1.5 text-[11px] text-pm-red">
                      {amountError}
                    </p>
                  )}

                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {QUICK_AMOUNTS.map((quick) => {
                      const disabled = quick > effectiveMax;
                      return (
                        <button
                          key={quick}
                          type="button"
                          disabled={disabled}
                          onClick={() => setCoverageAmount(String(quick))}
                          className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
                            disabled
                              ? "cursor-not-allowed border-pm-border/50 text-pm-text/25"
                              : "border-pm-border text-pm-text/60 hover:border-pm-violet/50 hover:text-pm-text"
                          }`}
                        >
                          {formatUsd(quick)}
                        </button>
                      );
                    })}
                  </div>

                  <label className="mb-1.5 mt-4 block text-xs font-medium text-pm-text/60" htmlFor="duration-days">
                    Duration (days)
                  </label>
                  <Input
                    id="duration-days"
                    type="number"
                    min={1}
                    max={365}
                    value={durationDays}
                    onChange={(e) => setDurationDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 1)))}
                  />

                  {isFlightDelay && (
                    <>
                      <label className="mb-1.5 mt-4 block text-xs font-medium text-pm-text/60" htmlFor="flight-number">
                        Flight number
                      </label>
                      <Input
                        id="flight-number"
                        value={flightNumber}
                        onChange={(e) => setFlightNumber(e.target.value)}
                        placeholder="e.g. AA100"
                        aria-invalid={flightNumberInvalid}
                      />
                      {flightNumberInvalid && (
                        <p className="mt-1.5 text-[11px] text-pm-red">Enter the flight number to monitor.</p>
                      )}
                    </>
                  )}
                </Card>
              )}
            </div>

            {/* Right: Quote panel */}
            <Card className="lg:sticky lg:top-6">
              <div className="mb-3 text-[11px] uppercase tracking-wide text-pm-text/40">Quote</div>

              {ct ? (
                <div className="flex flex-col gap-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-pm-text/50">Coverage</span>
                    <span className="font-semibold text-pm-text">{formatUsd(parseFloat(coverageAmount) || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-pm-text/50">Premium</span>
                    <span className="font-semibold text-pm-text">{formatUsd(premium)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-pm-text/50">Expires</span>
                    <span className="text-pm-text/80">{expiryDate}</span>
                  </div>

                  <div className="mt-1 border-t border-pm-border pt-2.5">
                    {poolLoading ? (
                      <p className="text-[11px] text-pm-text/40">Checking pool capacity…</p>
                    ) : capacity ? (
                      <p className="text-[11px] text-pm-text/50">
                        Pool can back up to{" "}
                        <span className="font-semibold text-pm-text/80">{formatUsd(capacity.maxCoverage)}</span>{" "}
                        of coverage right now.
                      </p>
                    ) : (
                      <p className="text-[11px] text-pm-amber">
                        Pool capacity couldn&apos;t be verified{poolError ? ` (${poolError})` : ""} — the amount
                        limit shown may not reflect what the pool can actually back.
                      </p>
                    )}
                  </div>

                  <Button
                    className="mt-2"
                    onClick={handleBuy}
                    disabled={submission.status === "submitting" || submission.status === "signing"}
                  >
                    {wallet.status !== "connected"
                      ? "Connect Wallet"
                      : submission.status === "submitting"
                        ? "Building transaction…"
                        : submission.status === "signing"
                          ? "Awaiting signature…"
                          : "Buy Coverage"}
                  </Button>

                  {submission.status === "error" && (
                    <p className="text-[11px] text-pm-red">{submission.message}</p>
                  )}
                  {submission.status === "success" && (
                    <p className="text-[11px] text-pm-green">
                      {submission.demo ? "Simulated locally (demo)." : "Coverage purchased."}
                      {submission.txHash ? ` ${truncateAddress(submission.txHash)}` : ""}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-pm-text/40">Select a coverage type to see your quote.</p>
              )}
            </Card>
          </div>
        </Container>
      </main>

      <Footer />
    </div>
  );
}

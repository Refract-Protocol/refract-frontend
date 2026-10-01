"use client";

import { useMemo, useRef, useState } from "react";
import { Navbar, Footer } from "@/components/layout";
import { Container, Card, Badge, Input, Button, Skeleton } from "@/components/ui";
import { WalletButton } from "@/components/wallet";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useCoverageTypes } from "@/hooks/useCoverageTypes";
import { useCoverageBounds } from "@/hooks/useCoverageBounds";
import { buyPolicy, type BuyPolicyResponse } from "@/lib/api/policies";
import { ApiUnreachableError } from "@/lib/api/client";
import { formatUsd, toStroops } from "@/lib/format";
import { truncateAddress } from "@/lib/wallet/WalletProvider";
import { signAndSubmit } from "@/lib/wallet/signAndSubmit";
import { coverageMeta, RISK_LEVEL_COLORS } from "@/lib/coverage/metadata";

const QUICK_AMOUNTS = [1_000, 5_000, 10_000, 25_000];

export default function CoverPage() {
  const wallet = useWallet();
  const { data: coverageTypes, loading: typesLoading, error: typesError, isFixture } = useCoverageTypes();
  const { minCoverage: chainMinCoverage, maxCoverage: chainMaxCoverage } = useCoverageBounds();

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
  const meta = coverageMeta(ct?.id ?? selectedType);

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
  // actually reject.
  const effectiveMin = Math.max(100, chainMinCoverage ?? 0);
  const effectiveMax = ct ? Math.min(ct.maxCoverage, chainMaxCoverage ?? ct.maxCoverage) : 0;
  const amountInvalid = ct
    ? parseFloat(coverageAmount || "0") < effectiveMin || parseFloat(coverageAmount) > effectiveMax
    : false;
  const isFlightDelay = ct?.id === 4;
  const flightNumberInvalid = isFlightDelay && flightNumber.trim().length === 0;

  async function handleBuy() {
    if (!ct) return;
    if (wallet.status !== "connected" || !wallet.address) {
      await wallet.connect();
      return;
    }
    if (amountInvalid || flightNumberInvalid) return;

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
                    {coverageTypes.map((t) => {
                      const tMeta = coverageMeta(t.id);
                      const selected = t.id === selectedType;
                      return (
                        <button
                          key={t.id}
                          ref={(el) => {
                            radioRefs.current[t.id] = el;
                          }}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          tabIndex={selected ? 0 : -1}
                          onClick={() => setSelectedType(t.id)}
                          className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                            selected
                              ? "border-pm-violet/60 bg-pm-violet/[0.08]"
                              : "border-pm-border bg-pm-surface hover:border-pm-violet/30"
                          }`}
                        >
                          <span aria-hidden="true" className="text-xl">
                            {tMeta.icon}
                          </span>
                          <span className="flex-1">
                            <span className="block text-sm font-semibold text-pm-text">{t.name}</span>
                            <span className="block text-[11px] text-pm-text/45">{tMeta.triggerSummary}</span>
                          </span>
                          <Badge
                            style={{ color: RISK_LEVEL_COLORS[tMeta.riskLevel] }}
                            className="!border-current/30"
                          >
                            {tMeta.riskLevel}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Amount + duration */}
              <div>
                <div className="mb-3 text-[11px] uppercase tracking-wide text-pm-text/40">2. Coverage Amount</div>
                <Input
                  type="number"
                  value={coverageAmount}
                  onChange={(e) => setCoverageAmount(e.target.value)}
                  aria-label="Coverage amount in USD"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {QUICK_AMOUNTS.map((amt) => (
                    <Button
                      key={amt}
                      variant="ghost"
                      size="sm"
                      onClick={() => setCoverageAmount(String(amt))}
                    >
                      {formatUsd(amt)}
                    </Button>
                  ))}
                </div>
                {amountInvalid && (
                  <p className="mt-2 text-[11px] text-pm-red">
                    Amount must be between {formatUsd(effectiveMin)} and {formatUsd(effectiveMax)}.
                  </p>
                )}
              </div>

              <div>
                <div className="mb-3 text-[11px] uppercase tracking-wide text-pm-text/40">3. Duration</div>
                <div className="flex flex-wrap gap-2">
                  {[7, 14, 30, 90].map((d) => (
                    <Button
                      key={d}
                      variant={durationDays === d ? "primary" : "ghost"}
                      size="sm"
                      onClick={() => setDurationDays(d)}
                    >
                      {d} days
                    </Button>
                  ))}
                </div>
              </div>

              {isFlightDelay && (
                <div>
                  <div className="mb-3 text-[11px] uppercase tracking-wide text-pm-text/40">4. Flight Number</div>
                  <Input
                    value={flightNumber}
                    onChange={(e) => setFlightNumber(e.target.value)}
                    placeholder="e.g. AA1234"
                    aria-label="Flight number"
                  />
                  {flightNumberInvalid && (
                    <p className="mt-2 text-[11px] text-pm-red">Enter the flight number to monitor.</p>
                  )}
                </div>
              )}
            </div>

            {/* Right: Summary */}
            <Card className="lg:sticky lg:top-6">
              <div className="mb-4 flex items-center gap-2">
                <span aria-hidden="true" className="text-2xl">
                  {meta.icon}
                </span>
                <div>
                  <div className="text-sm font-semibold text-pm-text">{ct?.name ?? meta.name}</div>
                  <div className="text-[11px] text-pm-text/45">{meta.oracleSource}</div>
                </div>
              </div>

              <div className="mb-4 flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-pm-text/45">Coverage</span>
                  <span className="text-pm-text">{formatUsd(parseFloat(coverageAmount) || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-pm-text/45">Duration</span>
                  <span className="text-pm-text">{durationDays} days</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-pm-text/45">Expires</span>
                  <span className="text-pm-text">{expiryDate}</span>
                </div>
                <div className="flex justify-between border-t border-pm-border pt-2">
                  <span className="text-pm-text/45">Premium</span>
                  <span className="font-semibold text-pm-text">{formatUsd(premium)}</span>
                </div>
              </div>

              <div className="mb-4">
                <div className="mb-1 flex justify-between text-[11px] text-pm-text/45">
                  <span>Risk</span>
                  <span>{meta.riskLevel}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-pm-border">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${meta.riskHeatPct}%`,
                      backgroundColor: RISK_LEVEL_COLORS[meta.riskLevel],
                    }}
                  />
                </div>
              </div>

              <Button
                variant="primary"
                className="w-full"
                onClick={handleBuy}
                disabled={submission.status === "submitting" || submission.status === "signing"}
              >
                {wallet.status === "connected" ? "Buy Coverage" : "Connect Wallet"}
              </Button>

              {submission.status === "success" && (
                <p className="mt-3 text-[11px] text-pm-green">
                  {submission.demo
                    ? "Simulated locally — no real transaction was submitted."
                    : `Policy purchased. Tx: ${truncateAddress(submission.txHash ?? "")}`}
                </p>
              )}
              {submission.status === "error" && (
                <p className="mt-3 text-[11px] text-pm-red">{submission.message}</p>
              )}
            </Card>
          </div>
        </Container>
      </main>

      <Footer />
    </div>
  );
}

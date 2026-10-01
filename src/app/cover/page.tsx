import { useMemo, useRef, useState } from "react";
import { Navbar, Footer } from "@/components/layout";
import { Container, Card, Badge, Input, Button, Skeleton, Meter, Slider } from "@/components/ui";
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
import { coverageMeta, RISK_LEVEL_COLORS } from "@/lib/coverage/metadata";

// Neutral fallbacks for risk levels the backend may introduce before this
// client knows about them. Deliberately muted so an unknown level never
// implies a specific risk tier the policy doesn't actually have.
const NEUTRAL_RISK_COLOR = "#6b7280";
const NEUTRAL_RISK_HEAT = 50;

function riskColor(riskLevel: string | undefined): string {
  if (riskLevel && Object.prototype.hasOwnProperty.call(RISK_TAG_COLORS, riskLevel)) {
    return RISK_TAG_COLORS[riskLevel] as string;
  }
  if (process.env.NODE_ENV !== "production" && riskLevel !== undefined) {
    console.warn(`[cover] Unknown risk level "${riskLevel}" — using neutral fallback`);
  }
  return NEUTRAL_RISK_COLOR;
}

function riskHeat(riskLevel: string | undefined): number {
  if (riskLevel && Object.prototype.hasOwnProperty.call(RISK_HEAT, riskLevel)) {
    return RISK_HEAT[riskLevel] as number;
  }
  return NEUTRAL_RISK_HEAT;
}

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
  const [connectError, setConnectError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "signing" }
    | { status: "success"; result: BuyPolicyResponse; demo: boolean; txHash?: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const radioRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const buyButtonRef = useRef<HTMLButtonElement | null>(null);

  const ct = coverageTypes?.find((t) => t.id === selectedType);
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
    setConnectError(null);

    let address = wallet.address;
    if (wallet.status !== "connected" || !address) {
      const connected = await wallet.connect();
      if (!connected) {
        setConnectError("Wallet connection failed or was declined. Please try again.");
        buyButtonRef.current?.focus();
        return;
      }
      address = connected;
    }

    // Re-validate against the (possibly newly connected) session before acting.
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
        holder: address,
        coverageType: ct.id,
        coverageAmount: toStroops(parseFloat(coverageAmount)),
        durationDays,
        ...(isFlightDelay ? { triggerParams: { flightNumber: flightNumber.trim() } } : {}),
      });

      setSubmission({ status: "signing" });
      if (!wallet.networkPassphrase) {
        throw new Error("Wallet network isn't available — reconnect and try again");
      }
      const txHash = await signAndSubmit(result.txXdr, address, wallet.networkPassphrase);
      setSubmission({ status: "success", result, demo: false, txHash });
    } catch (err) {
      if (err instanceof ApiUnreachableError) {
        // Backend isn't reachable in this environment — fall back to a
        // clearly-labeled client-side simulation so the flow can still be
        // demoed end-to-end. Nothing here is presented as a real payout.
        const demoResult: BuyPolicyResponse = {
          policy: {
            id: `demo-${crypto.randomUUID()}`,
            holder: address,
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
                      if (ids.length === 0) return;
                      const currentIndex = ids.indexOf(selectedType);
                      let nextIndex = currentIndex;
                      if (e.key === "ArrowDown") nextIndex = (currentIndex + 1) % ids.length;
                      if (e.key === "ArrowUp") nextIndex = (currentIndex - 1 + ids.length) % ids.length;
                      if (e.key === "Home") nextIndex = 0;
                      if (e.key === "End") nextIndex = ids.length - 1;
                      const nextId = ids[nextIndex];
                      if (nextId === undefined) return;
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
                          className={`flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-left transition-colors ${
                            selected
                              ? "border-pm-violet/60 bg-pm-violet/[0.08]"
                              : "border-pm-border bg-pm-surface hover:border-pm-border/80"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span aria-hidden="true" className="text-xl">
                              {tMeta.icon}
                            </span>
                            <div>
                              <div className="text-sm font-semibold text-pm-text">{t.name}</div>
                              <div className="text-[11px] text-pm-text/40">{tMeta.triggerSummary}</div>
                            </div>
                          </div>
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

              <div>
                <div className="mb-3 text-[11px] uppercase tracking-wide text-pm-text/40">2. Coverage Amount</div>
                <Input
                  label="Amount (USDC)"
                  type="number"
                  min={effectiveMin}
                  max={effectiveMax}
                  value={coverageAmount}
                  onChange={(e) => setCoverageAmount(e.target.value)}
                  error={
                    amountInvalid
                      ? `Amount must be between ${formatUsd(effectiveMin)} and ${formatUsd(effectiveMax)}`
                      : undefined
                  }
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {QUICK_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setCoverageAmount(String(amt))}
                      className="rounded-lg border border-pm-border px-2.5 py-1 text-[11px] text-pm-text/60 transition-colors hover:border-pm-violet/50 hover:text-pm-text"
                    >
                      {formatUsd(amt)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-3 text-[11px] uppercase tracking-wide text-pm-text/40">3. Duration</div>
                <Slider
                  label="Coverage duration"
                  value={durationDays}
                  onChange={setDurationDays}
                  min={1}
                  max={365}
                  step={1}
                  presets={[30, 60, 90, 365]}
                  formatValue={(days) => `${days} day${days === 1 ? "" : "s"}`}
                  hint="How long your cover lasts."
                />
              </div>

              {isFlightDelay && (
                <div>
                  <div className="mb-3 text-[11px] uppercase tracking-wide text-pm-text/40">4. Flight Number</div>
                  <Input
                    label="Flight number"
                    placeholder="e.g. AA1234"
                    value={flightNumber}
                    onChange={(e) => setFlightNumber(e.target.value)}
                    error={flightNumberInvalid ? "Flight number is required for flight delay coverage" : undefined}
                  />
                </div>
              )}
            </div>

            {/* Right: Summary + buy */}
            <Card className="lg:sticky lg:top-6">
              <div className="mb-4 text-[11px] uppercase tracking-wide text-pm-text/40">Summary</div>

              {ct ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-pm-text/50">Coverage type</span>
                    <span className="font-medium text-pm-text">{ct.name}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-pm-text/50">Coverage amount</span>
                    <span className="font-medium text-pm-text">{formatUsd(parseFloat(coverageAmount) || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-pm-text/50">Duration</span>
                    <span className="font-medium text-pm-text">{durationDays} days</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-pm-text/50">Expires</span>
                    <span className="font-medium text-pm-text">{expiryDate}</span>
                  </div>
                  <div className="my-1 h-px bg-pm-border" />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-pm-text/50">Premium</span>
                    <span className="font-display text-lg font-bold text-pm-text">{formatUsd(premium)}</span>
                  </div>

                  {/* Replaces the hand-rolled risk-heat bar (previously lines 386-394). */}
                  <Meter
                    label="Risk heat"
                    value={RISK_HEAT[ct.riskLevel]}
                    min={0}
                    max={100}
                    tone={
                      ct.riskLevel === "high"
                        ? "danger"
                        : ct.riskLevel === "medium"
                          ? "warning"
                          : "safe"
                    }
                    valueText={`${RISK_HEAT[ct.riskLevel]}%`}
                    showValue
                  />
                </div>
              ) : (
                <p className="text-sm text-pm-text/40">Select a coverage type to see your premium.</p>
              )}

              <div className="mt-5">
                <Button
                  ref={buyButtonRef}
                  className="w-full"
                  onClick={handleBuy}
                  disabled={
                    !ct ||
                    submission.status === "submitting" ||
                    submission.status === "signing" ||
                    wallet.status === "connecting"
                  }
                  loading={
                    submission.status === "submitting" ||
                    submission.status === "signing" ||
                    wallet.status === "connecting"
                  }
                >
                  {wallet.status === "connected" ? "Buy Coverage" : "Connect to Continue"}
                </Button>

                {connectError && (
                  <p role="alert" className="mt-2 text-xs text-pm-red">
                    {connectError}
                  </p>
                )}

                {submission.status === "error" && (
                  <p role="alert" className="mt-2 text-xs text-pm-red">
                    {submission.message}
                  </p>
                )}

                {submission.status === "success" && (
                  <div className="mt-3 rounded-lg border border-pm-green/30 bg-pm-green/[0.06] p-3">
                    <p className="text-xs text-pm-green">
                      {submission.demo
                        ? "Simulated purchase — no on-chain transaction was submitted."
                        : "Coverage purchased successfully."}
                    </p>
                    {submission.txHash && (
                      <p className="mt-1 break-all text-[11px] text-pm-text/40">tx: {submission.txHash}</p>
                    )}
                  </div>
                )}

                {wallet.status === "connected" && wallet.address && (
                  <p className="mt-2 text-center text-[11px] text-pm-text/40">
                    Buying as {truncateAddress(wallet.address)}
                  </p>
                )}
              </div>
            </Card>
          </div>
        </Container>
      </main>

      <Footer />
    </div>
  );
}

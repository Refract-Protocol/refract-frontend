"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Navbar, Footer } from "@/components/layout";
import { Container, Card, Badge, Input, Button, Skeleton, SuccessBurst, QuickAmountChips, Tour, TourReplayButton, useTour, type TourStep, AsyncState } from "@/components/ui";
import { WalletButton, WrongNetworkBanner, TxErrorMessage } from "@/components/wallet";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useCoverageTypes } from "@/hooks/useCoverageTypes";
import { useCoverageBounds } from "@/hooks/useCoverageBounds";
import { buyPolicy, type BuyPolicyResponse } from "@/lib/api/policies";
import { ApiUnreachableError } from "@/lib/api/client";
import { formatUsd, fromStroops, toStroops } from "@/lib/format";
import { truncateAddress } from "@/lib/wallet/WalletProvider";
import { signAndSubmit } from "@/lib/wallet/signAndSubmit";
import { useNetworkGuard } from "@/hooks/useNetworkGuard";
import { useTransactionStore } from "@/lib/store/useTransactionStore";
import { useTxReview } from "@/components/wallet/TxReview";
import {
  restoreCart,
  retryItem,
  runBatchCheckout,
  skipItem,
  type CartItem,
  type CartItemPatch,
  type CartItemStatus,
  type PurchaseResult,
} from "@/lib/cover/batchCheckout";
import { PreSignConfirmModal } from "@/components/PreSignConfirmModal";
import { useCoverQueryParams } from "@/hooks/useCoverQueryParams";
import { parseCoverQueryParams } from "@/lib/coverQueryParams";
import { PolicyCertificateModal } from "@/components/PolicyCertificate";
import { validateBuyCoverage } from "@/lib/validation/coverage";
import { searchFlights, POPULAR_FLIGHTS, type FlightInfo } from "@/lib/flights";

const RISK_TAG_COLORS: Record<string, string> = {
  low: "#10b981",
  medium: "#8b5cf6",
  high: "#f59e0b",
  critical: "#ef4444",
};

const RISK_HEAT: Record<string, number> = { low: 20, medium: 45, high: 72, critical: 95 };

const QUICK_AMOUNTS = [1_000, 5_000, 10_000, 25_000].map((v) => ({ label: `$${v.toLocaleString()}`, value: String(v) }));

const COVER_TOUR: TourStep[] = [
  { target: "cover-type", title: "Pick a coverage type", content: "Each type pays out automatically when its on-chain trigger fires — no claims form. Use the arrow keys to move between types." },
  { target: "cover-amount", title: "Set your coverage amount", content: "This is the USDC payout you'd receive if the trigger fires. Quick chips fill in common amounts." },
  { target: "cover-duration", title: "Choose a duration", content: "Your premium scales with how long the policy stays active, from 1 day up to a year." },
  { target: "cover-buy", title: "Review and buy", content: "Check the premium, then buy and confirm in your wallet — or add several policies to the cart and check out together." },
];

const CART_STORAGE_KEY = "refract:cover-cart";

const CART_STATUS_LABEL: Record<CartItemStatus, { label: string; className: string }> = {
  queued: { label: "Queued", className: "text-pm-text/45" },
  processing: { label: "Confirm in wallet…", className: "text-pm-violet" },
  confirmed: { label: "Confirmed", className: "text-pm-green" },
  failed: { label: "Failed", className: "text-pm-red" },
  unconfirmed: { label: "Unconfirmed", className: "text-pm-amber" },
  skipped: { label: "Skipped", className: "text-pm-text/30" },
};

const WIZARD_STEPS = [
  { id: 1, title: "Coverage Type", shortTitle: "Type" },
  { id: 2, title: "Trigger Parameters", shortTitle: "Trigger" },
  { id: 3, title: "Amount & Duration", shortTitle: "Amount" },
  { id: 4, title: "Review & Confirm", shortTitle: "Review" },
];

export default function CoverPage() {
  const wallet = useWallet();
  const { requestReview, reviewDialog } = useTxReview();
  const searchParams = useSearchParams();
  const { data: coverageTypes, loading: typesLoading, error: typesError, isFixture } = useCoverageTypes();
  const { isCorrectNetwork, expectedNetwork } = useNetworkGuard();
  const addTransaction = useTransactionStore((s) => s.addTransaction);
  const updateTransaction = useTransactionStore((s) => s.updateTransaction);
  const { minCoverage: chainMinCoverage, maxCoverage: chainMaxCoverage } = useCoverageBounds();

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [selectedType, setSelectedType] = useState<number>(0);
  const [coverageAmount, setCoverageAmount] = useState("5000");
  const [durationDays, setDurationDays] = useState(30);
  const [flightNumber, setFlightNumber] = useState("");
  const [flightQuery, setFlightQuery] = useState("");
  const [selectedFlight, setSelectedFlight] = useState<FlightInfo | null>(null);
  const [submission, setSubmission] = useState<
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "signing" }
    | { status: "success"; result: BuyPolicyResponse; demo: boolean; txHash?: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showCert, setShowCert] = useState(false);

  const radioRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const tour = useTour("cover");

  const initializedRef = useRef(false);

  // Initialize from URL search params on mount
  useEffect(() => {
    if (initializedRef.current) return;
    const parsed = parseCoverQueryParams(searchParams);
    if (parsed.type !== undefined) setSelectedType(parsed.type);
    if (parsed.amount !== undefined) setCoverageAmount(parsed.amount);
    if (parsed.duration !== undefined) setDurationDays(parsed.duration);
    if (parsed.flight !== undefined) setFlightNumber(parsed.flight);
    initializedRef.current = true;
  }, [searchParams]);

  // Sync state to URL params (debounced router.replace)
  useCoverQueryParams({
    type: selectedType,
    amount: coverageAmount,
    duration: durationDays,
    flight: flightNumber,
  });

  // Persist the cart so confirmed purchases (and anything mid-flight) survive
  // a reload or navigating away mid-batch.
  useEffect(() => {
    try {
      setCart(restoreCart(localStorage.getItem(CART_STORAGE_KEY)));
    } catch {
      // Storage unavailable — the cart just won't persist.
    }
    setCartLoaded(true);
  }, []);

  useEffect(() => {
    if (!cartLoaded) return;
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // Storage unavailable — the cart just won't persist.
    }
  }, [cart, cartLoaded]);

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

  const effectiveMin = Math.max(100, chainMinCoverage ?? 0);
  const effectiveMax = ct ? Math.min(ct.maxCoverage, chainMaxCoverage ?? ct.maxCoverage) : 0;
  const isFlightDelay = ct?.id === 4;

  const validation = validateBuyCoverage(
    { coverageAmount, flightNumber },
    { effectiveMin, effectiveMax, isFlightDelay }
  );
  const amountInvalid = !validation.isValid && !!validation.errors.coverageAmount;
  const flightNumberInvalid = isFlightDelay && (!flightNumber || flightNumber.trim().length === 0);

  const filteredFlights = useMemo(() => {
    return searchFlights(flightQuery);
  }, [flightQuery]);

  function handleSelectFlight(flight: FlightInfo) {
    setSelectedFlight(flight);
    setFlightNumber(flight.flightNumber);
    setFlightQuery(flight.flightNumber);
  }

  function addToCart() {
    if (!ct || amountInvalid || flightNumberInvalid) return;
    setCart((items) => [
      ...items,
      {
        id: crypto.randomUUID(),
        params: {
          coverageType: ct.id,
          coverageAmount: toStroops(parseFloat(coverageAmount)),
          durationDays,
          ...(isFlightDelay ? { triggerParams: { flightNumber: flightNumber.trim() } } : {}),
        },
        typeName: ct.name,
        icon: ct.icon,
        premium,
        status: "queued",
      },
    ]);
  }

  function updateCartItem(id: string, patch: CartItemPatch) {
    setCart((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function purchaseCartItem(item: CartItem, holder: string, networkPassphrase: string): Promise<PurchaseResult> {
    try {
      const result = await buyPolicy({ ...item.params, holder });
      const txHash = await signAndSubmit(result.txXdr, holder, networkPassphrase);
      return { policyId: result.policy.id, txHash, demo: false };
    } catch (err) {
      // Same clearly-labeled demo fallback as the single-purchase flow.
      if (err instanceof ApiUnreachableError) return { policyId: `demo-${crypto.randomUUID()}`, demo: true };
      throw err;
    }
  }

  async function handleCheckout() {
    if (wallet.status !== "connected" || !wallet.address) {
      await wallet.connect();
      return;
    }
    const { address, networkPassphrase } = wallet;
    if (!networkPassphrase) return;
    setCheckingOut(true);
    try {
      await runBatchCheckout(cart, (item) => purchaseCartItem(item, address, networkPassphrase), updateCartItem);
    } finally {
      setCheckingOut(false);
    }
  }

  async function handleBuy() {
    if (!ct) return;
    if (wallet.status !== "connected" || !wallet.address) {
      await wallet.connect();
      return;
    }
    if (amountInvalid || flightNumberInvalid || !isCorrectNetwork) return;
    setConfirmOpen(true);
  }

  async function submitBuy() {
    setConfirmOpen(false);
    if (!ct || !wallet.address) return;

    setSubmission({ status: "submitting" });
    const txId = addTransaction({ type: "buy", amount: parseFloat(coverageAmount) });
    try {
      const result = await buyPolicy({
        holder: wallet.address,
        coverageType: ct.id,
        coverageAmount: toStroops(parseFloat(coverageAmount)),
        durationDays,
        ...(isFlightDelay ? { triggerParams: { flightNumber: flightNumber.trim() } } : {}),
      });

      setSubmission({ status: "signing" });
      updateTransaction(txId, { status: "signing" });
      if (!wallet.networkPassphrase) {
        throw new Error("Wallet network isn't available — reconnect and try again");
      }
      const approved = await requestReview({
        txXdr: result.txXdr,
        networkPassphrase: wallet.networkPassphrase,
        action: "Buy coverage",
        entered: [
          { label: "Coverage type", value: ct.name },
          { label: "Coverage amount", value: formatUsd(parseFloat(coverageAmount)) },
          { label: "Duration", value: `${durationDays} days` },
        ],
        expectedStroops: toStroops(parseFloat(coverageAmount)),
      });
      if (!approved) {
        setSubmission({ status: "idle" });
        return;
      }
      const txHash = await signAndSubmit(result.txXdr, wallet.address, wallet.networkPassphrase, { hardware: wallet.hardwareWallet });
      setSubmission({ status: "success", result, demo: false, txHash });
      updateTransaction(txId, { status: "confirmed", txHash });
    } catch (err) {
      if (err instanceof ApiUnreachableError) {
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
        updateTransaction(txId, { status: "confirmed", demo: true });
        return;
      }
      const message = err instanceof Error ? err.message : "Something went wrong buying coverage";
      setSubmission({ status: "error", message });
      updateTransaction(txId, { status: "failed", error: message });
    }
  }

  return (
    <div className="min-h-screen bg-pm-bg">
      <Navbar right={<WalletButton />} />
      {reviewDialog}

      <main id="main-content">
        <Container className="py-9 sm:py-10">
          <div className="mb-8">
            <div className="mb-2 flex items-center gap-2.5">
              <h1 className="font-display text-[26px] font-extrabold tracking-tight text-pm-text sm:text-[28px]">
                Get Coverage
              </h1>
              <TourReplayButton onClick={tour.start} />
            </div>
            <p className="text-sm text-pm-text/45">
              Parametric coverage with automated on-chain settlement.
            </p>
            {isFixture && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-pm-amber">
                ⚠ Showing fixture data — the Refract API isn&apos;t reachable from this environment.
              </p>
            )}
          </div>

          <WrongNetworkBanner />

          {/* Stepper Progress Indicator */}
          <nav aria-label="Wizard progress" className="mb-8">
            <ol className="flex items-center justify-between gap-2 overflow-x-auto pb-2 sm:gap-4">
              {WIZARD_STEPS.map((step, idx) => {
                const isCurrent = currentStep === step.id;
                const isComplete = currentStep > step.id;
                return (
                  <li key={step.id} className="flex flex-1 items-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (step.id < currentStep || (step.id === 2 && ct) || (step.id === 3 && (!isFlightDelay || flightNumber)) || step.id === 4) {
                          setCurrentStep(step.id);
                        }
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-left transition-all ${
                        isCurrent
                          ? "border-pm-violet bg-pm-violet/10 text-pm-violet shadow-[0_0_15px_rgba(139,92,246,0.15)]"
                          : isComplete
                          ? "border-pm-green/40 bg-pm-green/[0.05] text-pm-green hover:border-pm-green/60"
                          : "border-white/5 bg-white/[0.02] text-pm-text/40"
                      }`}
                    >
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          isCurrent
                            ? "bg-pm-violet text-white"
                            : isComplete
                            ? "bg-pm-green text-white"
                            : "bg-white/10 text-pm-text/60"
                        }`}
                      >
                        {isComplete ? "✓" : step.id}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-wider opacity-60">
                          Step {step.id}
                        </div>
                        <div className="truncate text-xs font-bold text-pm-text">
                          {step.shortTitle}
                        </div>
                      </div>
                    </button>
                    {idx < WIZARD_STEPS.length - 1 && (
                      <span className="hidden h-px w-3 bg-white/10 sm:block" aria-hidden="true" />
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_360px]">
            {/* Left: Step Content */}
            <div className="flex flex-col gap-5">
              {/* STEP 1: Select Type */}
              {currentStep === 1 && (
                <div data-tour-id="cover-type">
                  <div className="mb-3 text-[11px] uppercase tracking-wide text-pm-text/40">
                    Step 1 of 4: Select Coverage Type
                  </div>

                  {typesError && (
                    <Card className="border-pm-red/30 !bg-pm-red/[0.04]">
                      <p className="text-sm text-pm-red">Couldn&apos;t load coverage types: {typesError}</p>
                    </Card>
                  )}

                  {typesLoading && (
                    <div className="flex flex-col gap-2.5" role="status" aria-label="Loading coverage types">
                      {Array.from({ length: 5 }).map((_, i
                  </div>

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
                  }
                  errorRender={(err) => (
                    <Card className="border-pm-red/30 !bg-pm-red/[0.04]">
                      <p className="text-sm text-pm-red">Couldn&apos;t load coverage types: {err}</p>
                    </Card>
                  )}
                >
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
                        setSubmission({ status: "idle" });
                        radioRefs.current[nextId]?.focus();
                      }}
                    >
                      {coverageTypes.map((type) => {
                        const active = selectedType === type.id;
                        return (
                          <button
                            key={type.id}
                            ref={(el) => {
                              radioRefs.current[type.id] = el;
                            }}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            tabIndex={active ? 0 : -1}
                            onClick={() => {
                              setSelectedType(type.id);
                              setSubmission({ status: "idle" });
                              if (type.id !== 4) {
                                setFlightNumber("");
                                setSelectedFlight(null);
                              }
                            }}
                            className="w-full rounded-[10px] border px-5 py-[18px] text-left transition-all"
                            style={{
                              background: active ? "rgba(139,92,246,0.1)" : "rgba(255,255,255,0.025)",
                              borderColor: active ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.06)",
                              boxShadow: active ? "0 0 20px rgba(139,92,246,0.1)" : "none",
                            }}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <span className="text-[22px]" aria-hidden="true">{type.icon}</span>
                                <div>
                                  <div className="mb-0.5 text-sm font-semibold text-pm-text">{type.name}</div>
                                  <div className="text-xs text-pm-text/40">{type.trigger}</div>
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div
                                  className="mb-0.5 text-[11px] font-semibold uppercase"
                                  style={{ color: RISK_TAG_COLORS[type.riskLevel] }}
                                >
                                  {type.riskLevel}
                                </div>
                                <div className="text-[13px] font-bold text-pm-violet">{type.baseRatePct}%/yr</div>
                              </div>
                            </div>
                            {active && (
                              <div className="mt-3 flex flex-wrap gap-2 border-t border-pm-violet/15 pt-3">
                                <Badge tone="violet">Auto-settle</Badge>
                                <Badge tone="violet">No form required</Badge>
                                <Badge tone="safe">On-chain</Badge>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </AsyncState>
              </div>

                  <div className="mt-6 flex justify-end">
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => setCurrentStep(2)}
                      disabled={!ct}
                    >
                      Next: Trigger Parameters →
                    </Button>
                  </div>
                </div>
              )}

              {/* STEP 2: Trigger Parameters */}
              {currentStep === 2 && ct && (
                <Card padding="md">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-pm-text/40">
                        Step 2 of 4: Trigger Parameters
                      </div>
                      <h2 className="text-lg font-bold text-pm-text">
                        {isFlightDelay ? "Flight Tracking & Trigger Lookup" : "Automated Oracle Trigger Parameters"}
                      </h2>
                    </div>
                    <span className="text-2xl">{ct.icon}</span>
                  </div>

                  {isFlightDelay ? (
                    <div className="flex flex-col gap-4">
                      <p className="text-xs leading-relaxed text-pm-text/60">
                        Enter your flight number or search popular commercial routes. The on-chain oracle will monitor flight status and automatically trigger a payout if departure is delayed &gt; 120 minutes.
                      </p>

                      <div className="relative">
                        <Input
                          label="Flight Number / Search Route"
                          type="text"
                          value={flightQuery}
                          onChange={(e) => {
                            const val = e.target.value.toUpperCase();
                            setFlightQuery(val);
                            setFlightNumber(val);
                          }}
                          placeholder="e.g. BA249, JFK, British Airways"
                          error={flightNumberInvalid ? "Please select or enter a valid flight number" : undefined}
                        />
                      </div>

                      {/* Suggestions list */}
                      <div>
                        <div className="mb-2 text-[11px] font-semibold text-pm-text/50">
                          {flightQuery ? "Matching Flights" : "Popular Monitored Routes"}
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {filteredFlights.map((f) => {
                            const isSelected = flightNumber === f.flightNumber;
                            return (
                              <button
                                key={f.flightNumber}
                                type="button"
                                onClick={() => handleSelectFlight(f)}
                                className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-all ${
                                  isSelected
                                    ? "border-pm-violet bg-pm-violet/15 shadow-[0_0_15px_rgba(139,92,246,0.15)]"
                                    : "border-white/5 bg-white/[0.02] hover:border-white/15"
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-mono text-xs font-bold text-pm-violet">{f.flightNumber}</span>
                                  <span className="text-[10px] text-pm-text/40">{f.departureTime}</span>
                                </div>
                                <div className="text-xs font-semibold text-pm-text">{f.airline}</div>
                                <div className="text-[11px] text-pm-text/50">{f.from} → {f.to}</div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {selectedFlight && (
                        <div className="mt-2 rounded-lg border border-pm-green/20 bg-pm-green/[0.06] p-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-pm-green">✓ Flight Selected: {selectedFlight.flightNumber}</span>
                            <span className="text-[11px] text-pm-text/40">Oracle Source: Chainlink FlightStats</span>
                          </div>
                          <div className="mt-1 text-xs text-pm-text/70">
                            {selectedFlight.airline} · {selectedFlight.from} to {selectedFlight.to} ({selectedFlight.departureTime})
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4">
                        <div className="mb-2 text-xs font-semibold text-pm-text">Monitoring Condition</div>
                        <div className="text-sm font-medium text-pm-violet">{ct.trigger}</div>
                        <div className="mt-3 text-xs leading-relaxed text-pm-text/50">
                          Refract contracts autonomously poll decentralized oracle feeds. When trigger criteria are met on-chain, payouts are disbursed directly to your wallet without claim forms.
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                          <div className="text-[10px] uppercase text-pm-text/40">Resolution Oracle</div>
                          <div className="text-xs font-semibold text-pm-text">Pyth & Chainlink Feeds</div>
                        </div>
                        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                          <div className="text-[10px] uppercase text-pm-text/40">Settlement Speed</div>
                          <div className="text-xs font-semibold text-pm-green">Sub-minute (~5s on Soroban)</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-6 flex items-center justify-between border-t border-pm-border pt-4">
                    <Button type="button" variant="outline" onClick={() => setCurrentStep(1)}>
                      ← Back
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => setCurrentStep(3)}
                      disabled={isFlightDelay && (!flightNumber || flightNumber.trim().length === 0)}
                    >
                      Next: Amount & Duration →
                    </Button>
                  </div>
                </Card>
              )}

              {/* STEP 3: Amount & Duration */}
              {currentStep === 3 && ct && (
                <Card padding="md">
                  <div className="mb-5 text-[11px] uppercase tracking-wide text-pm-text/40">
                    Step 3 of 4: Coverage Amount & Duration
                  </div>

                  <div className="mb-6">
                    <Input
                      label="Coverage Amount (USDC)"
                      type="number"
                      inputMode="decimal"
                      value={coverageAmount}
                      onChange={(e) => setCoverageAmount(e.target.value)}
                      placeholder="5000"
                      min={effectiveMin}
                      max={effectiveMax}
                      error={
                        amountInvalid
                          ? `Enter an amount between $${effectiveMin.toLocaleString()} and $${effectiveMax.toLocaleString()}`
                          : undefined
                      }
                    />
                    <QuickAmountChips chips={QUICK_AMOUNTS} onSelect={setCoverageAmount} />
                  </div>

                  {isFlightDelay && (
                    <div className="mb-5">
                      <Input
                        label="Flight Number"
                        type="text"
                        value={flightNumber}
                        onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
                        placeholder="BA249"
                        error={flightNumberInvalid ? "Enter the flight number this policy should monitor" : undefined}
                      />
                    </div>
                  )}

                  <div data-tour-id="cover-duration">
                    <div className="mb-2 flex justify-between">
                      <label htmlFor="duration" className="text-xs text-pm-text/60">
                        Coverage Duration
                      </label>
                      <span className="text-[13px] font-bold text-pm-violet">
                        {durationDays} days · Expires {expiryDate}
                      </span>
                    </div>
                    <input

            {/* Right: Quote panel */}
            <div className="flex flex-col gap-5 lg:sticky lg:top-20">
              {!ct ? (
                <Card padding="md">
                  <Skeleton height={220} rounded="md" />
                </Card>
              ) : submission.status === "success" ? (
                <Card padding="md" role="status" aria-live="polite">
                  <div className="mb-4 flex items-center gap-2.5 text-pm-green">
                    <SuccessBurst />
                    <span className="font-display text-base font-bold">Coverage purchased</span>
                  </div>
                  {submission.demo && (
                    <p className="mb-4 rounded-md border border-pm-amber/20 bg-pm-amber/[0.06] px-3 py-2 text-[11px] leading-relaxed text-pm-amber">
                      Demo mode: the Refract API wasn&apos;t reachable, so this was simulated client-side —
                      no real transaction was built or submitted.
                    </p>
                  )}
                  <dl className="flex flex-col gap-2 text-[13px]">
                    <div className="flex justify-between">
                      <dt className="text-pm-text/45">Policy ID</dt>
                      <dd className="font-mono text-pm-text">{submission.result.policy.id.slice(0, 13)}…</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-pm-text/45">Coverage</dt>
                      <dd className="text-pm-text">{submission.result.policy.coverageTypeName}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-pm-text/45">Holder</dt>
                      <dd className="font-mono text-pm-text">{truncateAddress(submission.result.policy.holder)}</dd>
                    </div>
                    {submission.txHash && (
                      <div className="flex justify-between">
                        <dt className="text-pm-text/45">Transaction</dt>
                        <dd className="font-mono text-pm-text">{truncateAddress(submission.txHash)}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="mt-5 flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      block
                      onClick={() => setShowCert(true)}
                    >
                      📄 View / Print Certificate
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      block
                      onClick={() => setSubmission({ status: "idle" })}
                    >
                      Buy another policy
                    </Button>
                  </div>

                  <PolicyCertificateModal
                    isOpen={showCert}
                    onClose={() => setShowCert(false)}
                    policy={{
                      ...submission.result.policy,
                      txHash: submission.txHash,
                      demo: submission.demo,
                    }}
                  />
                </Card>
              ) : (
                <Card padding="md">
                  <div className="mb-6 flex items-center gap-2.5">
                    <span className="text-[22px]" aria-hidden="true">{ct.icon}</span>
                    <div>
                      <div className="text-[15px] font-bold text-pm-text">{ct.name}</div>
                      <div className="text-xs text-pm-text/40">{durationDays}-day policy</div>
                    </div>
                  </div>

                  <div className="mb-5">
                    <div className="mb-1.5 flex justify-between">
                      <span className="text-[11px] text-pm-text/40">Risk level</span>
                      <span className="text-[11px] font-semibold uppercase" style={{ color: RISK_TAG_COLORS[ct.riskLevel] }}>
                        {ct.riskLevel}
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${RISK_HEAT[ct.riskLevel]}%`,
                          background: `linear-gradient(90deg,#10b981,${RISK_TAG_COLORS[ct.riskLevel]})`,
                        }}
                      />
                    </div>
                  </div>

                  <dl className="mb-5 flex flex-col gap-2.5">
                    {[
                      { label: "Coverage amount", value: formatUsd(parseFloat(coverageAmount || "0")) },
                      { label: "Annual rate", value: `${ct.baseRatePct}%` },
                      { label: "Duration", value: `${durationDays} days` },
                      { label: "Expires", value: expiryDate },
                    ].map((item) => (
                      <div key={item.label} className="flex justify-between">
                        <dt className="text-[13px] text-pm-text/45">{item.label}</dt>
                        <dd className="text-[13px] font-medium text-pm-text">{item.value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mb-5 border-t border-pm-border pt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-pm-text/60">Total premium</span>
                      <span className="font-display text-2xl font-extrabold text-pm-violet">{formatUsd(premium)}</span>
                    </div>
                    <div className="mt-0.5 text-right text-[11px] text-pm-text/30">One-time payment · USDC</div>
                  </div>

                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    block
                    data-tour-id="cover-buy"
                    disabled={amountInvalid || flightNumberInvalid || !isCorrectNetwork}
                    title={!isCorrectNetwork ? `Switch your wallet to ${expectedNetwork} to continue` : undefined}
                    loading={
                      submission.status === "submitting" ||
                      submission.status === "signing" ||
                      wallet.status === "connecting"
                    }
                    onClick={() => void handleBuy()}
                  >
                    {submission.status === "signing"
                      ? wallet.hardwareWallet
                        ? "Confirm on your Ledger device…"
                        : "Confirm in wallet…"
                      : !isCorrectNetwork
                        ? `Switch to ${expectedNetwork}`
                        : wallet.status === "connected"
                        ? "Buy Coverage"
                        : "Connect to Continue"}
                  </Button>

                  {submission.status === "error" && <TxErrorMessage rawError={submission.message} />}

                  <Button
                    type="button"
                    variant="outline"
                    block
                    className="mt-2.5"
                    disabled={amountInvalid || flightNumberInvalid || checkingOut}
                    onClick={addToCart}
                  >
                    Add to cart
                  </Button>

                  <div className="mt-4 flex flex-col gap-1.5">
                    {["🔒 No claims form required", "⚡ Instant payout via oracle", "🌐 Fully on-chain, non-custodial"].map(
                      (item) => (
                        <div key={item} className="text-[11px] text-pm-text/35">
                          {item}
                        </div>
                      )
                    )}
                  </div>
                </Card>
              )}

              {cart.length > 0 && (
                <Card padding="md">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-display text-[15px] font-bold tracking-tight text-pm-text">Cart</h2>
                    <span className="text-[11px] text-pm-text/45" aria-live="polite">
                      {cart.filter((i) => i.status === "confirmed").length} of{" "}
                      {cart.filter((i) => i.status !== "skipped").length} confirmed
                    </span>
                  </div>
                  <ol className="flex flex-col gap-2.5">
                    {cart.map((item, index) => (
                      <li key={item.id} className="rounded-md border border-pm-border px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] text-pm-text">
                            <span className="mr-1.5 text-pm-text/35">{index + 1}.</span>
                            <span aria-hidden="true">{item.icon}</span> {item.typeName}
                          </span>
                          <span className={`text-[11px] font-semibold ${CART_STATUS_LABEL[item.status].className}`}>
                            {CART_STATUS_LABEL[item.status].label}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-pm-text/40">
                          {formatUsd(fromStroops(item.params.coverageAmount))} · {item.params.durationDays} days ·{" "}
                          {formatUsd(item.premium)} premium
                          {item.demo && " · demo"}
                          {item.txHash && ` · tx ${truncateAddress(item.txHash)}`}
                        </div>
                        {item.error && item.status === "failed" && <TxErrorMessage rawError={item.error} />}
                        {item.error && item.status === "unconfirmed" && (
                          <p className="mt-1.5 text-[11px] text-pm-amber">
                            This may still have gone through — check your Dashboard before buying it again. ({item.error})
                          </p>
                        )}
                        {!checkingOut && item.status !== "processing" && (
                          <div className="mt-2 flex gap-3 text-[11px]">
                            {item.status === "failed" && (
                              <button
                                type="button"
                                className="text-pm-violet"
                                onClick={() => setCart((items) => items.map((i) => (i.id === item.id ? retryItem(i) : i)))}
                              >
                                Retry
                              </button>
                            )}
                            {item.status === "failed" && (
                              <button
                                type="button"
                                className="text-pm-text/45"
                                onClick={() => setCart((items) => items.map((i) => (i.id === item.id ? skipItem(i) : i)))}
                              >
                                Skip
                              </button>
                            )}
                            <button
                              type="button"
                              className="text-pm-text/45"
                              onClick={() => setCart((items) => items.filter((i) => i.id !== item.id))}
                            >
                              {item.status === "queued" ? "Remove" : "Dismiss"}
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                  <Button
                    type="button"
                    variant="primary"
                    block
                    className="mt-4"
                    disabled={!checkingOut && !cart.some((i) => i.status === "queued")}
                    loading={checkingOut || wallet.status === "connecting"}
                    onClick={() => void handleCheckout()}
                  >
                    {wallet.status !== "connected"
                      ? "Connect to Checkout"
                      : `Checkout ${cart.filter((i) => i.status === "queued").length} ${
                          cart.filter((i) => i.status === "queued").length === 1 ? "policy" : "policies"
                        }`}
                  </Button>
                </Card>
              )}
            </div>
          </div>
        </Container>
      </main>

      {ct && (
        <PreSignConfirmModal
          open={confirmOpen}
          title="Confirm coverage purchase"
          lines={[
            { label: "Action", value: "Buy coverage" },
            { label: "Coverage type", value: ct.name },
            { label: "Coverage amount", value: formatUsd(parseFloat(coverageAmount || "0")) },
            { label: "Duration", value: `${durationDays} days · Expires ${expiryDate}` },
            ...(isFlightDelay ? [{ label: "Flight", value: flightNumber.trim() }] : []),
          ]}
          total={{ label: "Estimated total cost", value: formatUsd(premium) }}
          hardwareWallet={wallet.hardwareWallet}
          onConfirm={() => void submitBuy()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}

      <Footer />
      <Tour steps={COVER_TOUR} open={tour.open} onClose={tour.close} />
    </div>
  );
}

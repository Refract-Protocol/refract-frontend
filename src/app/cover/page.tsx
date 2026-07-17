"use client";

import { useMemo, useRef, useState } from "react";
import { Navbar, Footer } from "@/components/layout";
import { Container, Card, Badge, Input, Button, Skeleton } from "@/components/ui";
import { WalletButton } from "@/components/wallet";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useCoverageTypes } from "@/hooks/useCoverageTypes";
import { buyPolicy, type BuyPolicyResponse } from "@/lib/api/policies";
import { ApiUnreachableError } from "@/lib/api/client";
import { formatUsd, toStroops } from "@/lib/format";
import { truncateAddress } from "@/lib/wallet/WalletProvider";

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

  const [selectedType, setSelectedType] = useState(0);
  const [coverageAmount, setCoverageAmount] = useState("5000");
  const [durationDays, setDurationDays] = useState(30);
  const [submission, setSubmission] = useState<
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "success"; result: BuyPolicyResponse; demo: boolean }
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

  const amountInvalid = ct ? parseFloat(coverageAmount || "0") <= 0 || parseFloat(coverageAmount) > ct.maxCoverage : false;

  async function handleBuy() {
    if (!ct) return;
    if (wallet.status !== "connected" || !wallet.address) {
      await wallet.connect();
      return;
    }
    if (amountInvalid) return;

    setSubmission({ status: "submitting" });
    try {
      const result = await buyPolicy({
        holder: wallet.address,
        coverageType: ct.id,
        coverageAmount: toStroops(parseFloat(coverageAmount)),
        durationDays,
      });
      setSubmission({ status: "success", result, demo: false });
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
              </div>

              {/* Configuration */}
              {ct && (
                <Card padding="md">
                  <div className="mb-5 text-[11px] uppercase tracking-wide text-pm-text/40">2. Configure Policy</div>

                  <div className="mb-5">
                    <Input
                      label="Coverage Amount (USDC)"
                      type="number"
                      inputMode="decimal"
                      value={coverageAmount}
                      onChange={(e) => setCoverageAmount(e.target.value)}
                      placeholder="5000"
                      min={100}
                      max={ct.maxCoverage}
                      error={amountInvalid ? `Enter an amount between $100 and $${ct.maxCoverage.toLocaleString()}` : undefined}
                    />
                    <div className="mt-2 flex gap-1.5">
                      {QUICK_AMOUNTS.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setCoverageAmount(String(v))}
                          className="flex-1 rounded border border-pm-violet/15 bg-pm-violet/[0.08] py-1.5 text-[11px] text-pm-violet"
                        >
                          ${v.toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 flex justify-between">
                      <label htmlFor="duration" className="text-xs text-pm-text/60">
                        Coverage Duration
                      </label>
                      <span className="text-[13px] font-bold text-pm-violet">
                        {durationDays} days · Expires {expiryDate}
                      </span>
                    </div>
                    <input
                      id="duration"
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
                      <span className="text-[10px] text-pm-text/30">1 year</span>
                    </div>
                  </div>
                </Card>
              )}
            </div>

            {/* Right: Quote panel */}
            <div className="lg:sticky lg:top-20">
              {!ct ? (
                <Card padding="md">
                  <Skeleton height={220} rounded="md" />
                </Card>
              ) : submission.status === "success" ? (
                <Card padding="md" role="status" aria-live="polite">
                  <div className="mb-4 flex items-center gap-2.5 text-pm-green">
                    <span className="text-xl" aria-hidden="true">✓</span>
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
                  </dl>
                  <Button
                    type="button"
                    variant="outline"
                    block
                    className="mt-5"
                    onClick={() => setSubmission({ status: "idle" })}
                  >
                    Buy another policy
                  </Button>
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
                    disabled={amountInvalid}
                    loading={submission.status === "submitting" || wallet.status === "connecting"}
                    onClick={() => void handleBuy()}
                  >
                    {wallet.status === "connected" ? "Buy Coverage" : "Connect to Continue"}
                  </Button>

                  {submission.status === "error" && (
                    <p role="alert" className="mt-3 text-[12px] text-pm-red">
                      {submission.message}
                    </p>
                  )}

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
            </div>
          </div>
        </Container>
      </main>

      <Footer />
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Navbar, Footer } from "@/components/layout";
import { Container, Card, Badge, Input, Button, Skeleton } from "@/components/ui";
import { WalletButton } from "@/components/wallet";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { usePoolStats } from "@/hooks/usePoolStats";
import { useUserPoolPosition } from "@/hooks/useUserPoolPosition";
import { provideCapital, withdrawCapital, type ProvideCapitalResponse, type WithdrawCapitalResponse } from "@/lib/api/pool";
import { ApiUnreachableError } from "@/lib/api/client";
import { formatUsd, fromStroops, toStroops } from "@/lib/format";

// Illustrative allocation breakdown by coverage category — the backend
// doesn't currently expose a per-category pool split, so this is presented
// as UI context rather than fetched data.
const RISK_BREAKDOWN = [
  { type: "Stablecoin Depeg", color: "#8b5cf6", pct: 22 },
  { type: "Market Crash", color: "#f59e0b", pct: 18 },
  { type: "Liquidation Shield", color: "#10b981", pct: 35 },
  { type: "Smart Contract Risk", color: "#ef4444", pct: 15 },
  { type: "Flight Delay", color: "#06b6d4", pct: 10 },
];

type SubmissionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; kind: "deposit"; result: ProvideCapitalResponse; demo: boolean }
  | { status: "success"; kind: "withdraw"; result: WithdrawCapitalResponse; demo: boolean }
  | { status: "error"; message: string };

export default function ProvidePage() {
  const wallet = useWallet();
  const { data: pool, loading: poolLoading, isFixture: poolIsFixture } = usePoolStats();
  const { data: position } = useUserPoolPosition(wallet.status === "connected" ? wallet.address : null);

  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [submission, setSubmission] = useState<SubmissionState>({ status: "idle" });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const sharePrice = pool?.sharePrice ?? 1;
  const userShares = position ? fromStroops(position.shares) : 0;

  const sharesOut = amount ? (parseFloat(amount) / sharePrice).toFixed(4) : "—";
  const usdcOut = amount ? (parseFloat(amount) * sharePrice).toFixed(2) : "—";

  const utilizationPct = pool ? pool.utilizationBps / 100 : 0;
  const maxUtilizationPct = pool ? pool.maxUtilizationBps / 100 : 80;

  // Donut chart for the illustrative risk breakdown
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = 160;
    canvas.width = canvas.height = size * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const cx = size / 2, cy = size / 2, r = 62, innerR = 42;
    let startAngle = -Math.PI / 2;

    RISK_BREAKDOWN.forEach((seg) => {
      const angle = (seg.pct / 100) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, startAngle, startAngle + angle);
      ctx.arc(cx, cy, innerR, startAngle + angle, startAngle, true);
      ctx.fillStyle = seg.color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, r + 1, startAngle, startAngle + angle);
      ctx.arc(cx, cy, innerR - 1, startAngle + angle, startAngle, true);
      ctx.fillStyle = "rgba(7,5,15,0.5)";
      ctx.lineWidth = 2;
      ctx.fill();
      startAngle += angle;
    });
  }, []);

  const withdrawQuickPct = useMemo(
    () => [
      { label: "25%", value: userShares * 0.25 * sharePrice },
      { label: "50%", value: userShares * 0.5 * sharePrice },
      { label: "75%", value: userShares * 0.75 * sharePrice },
      { label: "MAX", value: userShares * sharePrice },
    ],
    [userShares, sharePrice]
  );

  async function handleSubmit() {
    if (wallet.status !== "connected" || !wallet.address) {
      await wallet.connect();
      return;
    }
    const parsed = parseFloat(amount || "0");
    if (parsed <= 0) return;

    setSubmission({ status: "submitting" });
    try {
      if (tab === "deposit") {
        const result = await provideCapital(wallet.address, toStroops(parsed));
        setSubmission({ status: "success", kind: "deposit", result, demo: false });
      } else {
        const result = await withdrawCapital(wallet.address, toStroops(parsed / sharePrice));
        setSubmission({ status: "success", kind: "withdraw", result, demo: false });
      }
    } catch (err) {
      if (err instanceof ApiUnreachableError) {
        // Backend unreachable in this environment — simulate locally,
        // clearly labeled, so the flow can still be exercised end-to-end.
        if (tab === "deposit") {
          const demoResult: ProvideCapitalResponse = {
            provider: wallet.address,
            amountUsdc: toStroops(parsed),
            sharesOut: toStroops(parsed / sharePrice),
            sharePrice,
            txXdr: "DEMO_MODE — backend unreachable, no transaction was built",
            message: "Simulated locally: the Refract API is not running in this environment.",
          };
          setSubmission({ status: "success", kind: "deposit", result: demoResult, demo: true });
        } else {
          const demoResult: WithdrawCapitalResponse = {
            provider: wallet.address,
            sharesIn: toStroops(parsed / sharePrice),
            usdcOut: toStroops(parsed),
            sharePrice,
            txXdr: "DEMO_MODE — backend unreachable, no transaction was built",
          };
          setSubmission({ status: "success", kind: "withdraw", result: demoResult, demo: true });
        }
        return;
      }
      setSubmission({ status: "error", message: err instanceof Error ? err.message : "Something went wrong" });
    }
  }

  return (
    <div className="min-h-screen bg-pm-bg">
      <Navbar right={<WalletButton />} />

      <main id="main-content">
        <Container className="py-9 sm:py-10">
          <div className="mb-8">
            <h1 className="mb-2 font-display text-[26px] font-extrabold tracking-tight text-pm-text sm:text-[28px]">
              Provide Capital
            </h1>
            <p className="text-sm text-pm-text/45">
              Underwrite Refract policies. Earn premiums when no triggers fire. Pool capital backs all coverage
              categories.
            </p>
            {poolIsFixture && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-pm-amber">
                ⚠ Showing fixture data — the Refract API isn&apos;t reachable from this environment.
              </p>
            )}
          </div>

          {/* Stats */}
          <div className="mb-7 grid grid-cols-2 gap-3.5 sm:grid-cols-4">
            {poolLoading || !pool
              ? Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} padding="sm" className="!p-[18px]">
                    <Skeleton height={11} width={70} className="mb-2.5" />
                    <Skeleton height={22} width={90} />
                  </Card>
                ))
              : [
                  { label: "Pool TVL", value: `$${(Number(pool.totalUsdc) / 1e7 / 1e6).toFixed(1)}M` },
                  { label: "30d APY", value: `${(pool.apyBps / 100).toFixed(1)}%`, accent: true },
                  { label: "Share Price", value: `$${pool.sharePrice}` },
                  { label: "Utilization", value: `${utilizationPct.toFixed(2)}%` },
                ].map((s) => (
                  <Card key={s.label} padding="sm" className="!p-[18px]">
                    <div className="mb-1.5 text-[11px] uppercase tracking-wide text-pm-text/40">{s.label}</div>
                    <div className={`font-display text-[22px] font-extrabold tracking-tight ${s.accent ? "text-pm-green" : "text-pm-text"}`}>
                      {s.value}
                    </div>
                  </Card>
                ))}
          </div>

          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_360px]">
            {/* Left: Pool info */}
            <div className="flex flex-col gap-5">
              <Card padding="md">
                <h3 className="mb-5 font-display text-base font-bold tracking-tight text-pm-text">Capital Allocation</h3>
                <div className="grid grid-cols-1 items-center gap-8 xs:grid-cols-[160px_1fr]">
                  <canvas ref={canvasRef} style={{ width: 160, height: 160 }} className="mx-auto xs:mx-0" aria-hidden="true" />
                  <ul className="flex flex-col gap-2.5">
                    {RISK_BREAKDOWN.map((seg) => (
                      <li key={seg.type} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: seg.color }} aria-hidden="true" />
                          <span className="text-xs text-pm-text/60">{seg.type}</span>
                        </div>
                        <span className="text-xs font-semibold text-pm-text">{seg.pct}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>

              <Card padding="md">
                <h3 className="mb-5 font-display text-base font-bold tracking-tight text-pm-text">
                  How capital provision works
                </h3>
                <ol className="flex flex-col gap-3.5">
                  {[
                    { n: "01", title: "Deposit USDC", desc: "Receive Refract pool shares (PPS) proportional to your deposit." },
                    { n: "02", title: "Underwrite policies", desc: "Your capital backs coverage sold to policy buyers. You collect premiums upfront." },
                    { n: "03", title: "Earn continuously", desc: "Premium yield accrues to your PPS shares, increasing their USDC value over time." },
                    { n: "04", title: "Shared risk", desc: "If a payout fires, it's split proportionally across all capital providers — not concentrated on any one LP." },
                  ].map((item) => (
                    <li key={item.n} className="flex gap-4">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-pm-violet/15 text-[11px] font-bold text-pm-violet">
                        {item.n}
                      </div>
                      <div>
                        <div className="mb-0.5 text-[13px] font-semibold text-pm-text">{item.title}</div>
                        <div className="text-xs leading-relaxed text-pm-text/45">{item.desc}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>

              <Card padding="md">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-display text-[15px] font-bold tracking-tight text-pm-text">Pool Capacity</h3>
                  <span className={`text-[13px] font-bold ${utilizationPct > 70 ? "text-pm-amber" : "text-pm-green"}`}>
                    {utilizationPct.toFixed(2)}% utilized
                  </span>
                </div>
                <div className="mb-2 h-2 overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-pm-violet to-pm-green"
                    style={{ width: `${pool ? (utilizationPct / maxUtilizationPct) * 100 : 0}%` }}
                  />
                </div>
                <div className="flex flex-col justify-between gap-1 text-[11px] text-pm-text/35 xs:flex-row">
                  <span>{pool ? `$${(Number(pool.lockedUsdc) / 1e7 / 1e6).toFixed(1)}M locked in policies` : "—"}</span>
                  <span>{pool ? `$${(Number(pool.totalUsdc) / 1e7 / 1e6).toFixed(1)}M total / ${maxUtilizationPct}% max` : "—"}</span>
                </div>
              </Card>
            </div>

            {/* Right: Deposit/withdraw form */}
            <div className="lg:sticky lg:top-20">
              {submission.status === "success" ? (
                <Card padding="md" role="status" aria-live="polite">
                  <div className="mb-4 flex items-center gap-2.5 text-pm-green">
                    <span className="text-xl" aria-hidden="true">✓</span>
                    <span className="font-display text-base font-bold">
                      {submission.kind === "deposit" ? "Capital provided" : "Withdrawal submitted"}
                    </span>
                  </div>
                  {submission.demo && (
                    <p className="mb-4 rounded-md border border-pm-amber/20 bg-pm-amber/[0.06] px-3 py-2 text-[11px] leading-relaxed text-pm-amber">
                      Demo mode: the Refract API wasn&apos;t reachable, so this was simulated client-side —
                      no real transaction was built or submitted.
                    </p>
                  )}
                  <dl className="flex flex-col gap-2 text-[13px]">
                    <div className="flex justify-between">
                      <dt className="text-pm-text/45">{submission.kind === "deposit" ? "Shares received" : "USDC received"}</dt>
                      <dd className="text-pm-text">
                        {submission.kind === "deposit"
                          ? fromStroops(submission.result.sharesOut).toFixed(4)
                          : formatUsd(fromStroops(submission.result.usdcOut))}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-pm-text/45">Share price</dt>
                      <dd className="text-pm-text">${submission.result.sharePrice}</dd>
                    </div>
                  </dl>
                  <Button type="button" variant="outline" block className="mt-5" onClick={() => { setSubmission({ status: "idle" }); setAmount(""); }}>
                    Make another transaction
                  </Button>
                </Card>
              ) : (
                <Card padding="md">
                  <div className="mb-6 flex gap-1 rounded-lg bg-white/[0.03] p-1" role="tablist" aria-label="Deposit or withdraw">
                    {(["deposit", "withdraw"] as const).map((t) => (
                      <button
                        key={t}
                        role="tab"
                        aria-selected={tab === t}
                        onClick={() => {
                          setTab(t);
                          setAmount("");
                          setSubmission({ status: "idle" });
                        }}
                        className={`flex-1 rounded-md py-2 text-[13px] font-semibold capitalize transition-colors ${
                          tab === t ? "bg-pm-violet/15 text-pm-violet" : "text-pm-text/40"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <div className="mb-5 flex items-center justify-between rounded-lg border border-pm-violet/15 bg-pm-violet/[0.07] px-3.5 py-2.5">
                    <span className="text-xs text-pm-text/50">PPS share price</span>
                    <span className="text-sm font-bold text-pm-violet">${sharePrice}</span>
                  </div>

                  {tab === "withdraw" && wallet.status === "connected" && (
                    <div className="mb-4 text-xs text-pm-text/40">
                      Your position: <span className="font-semibold text-pm-text">{userShares.toFixed(4)} shares</span> ·{" "}
                      {formatUsd(userShares * sharePrice)}
                    </div>
                  )}

                  <div className="mb-4">
                    <Input
                      label={tab === "deposit" ? "USDC Amount" : "USDC to withdraw"}
                      type="number"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <div className="mt-2 flex gap-1.5">
                      {tab === "deposit"
                        ? ["1,000", "5,000", "10,000", "25,000"].map((v) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() => setAmount(v.replace(",", ""))}
                              className="flex-1 rounded border border-pm-violet/15 bg-pm-violet/[0.06] py-1 text-[10px] text-pm-violet"
                            >
                              ${v}
                            </button>
                          ))
                        : withdrawQuickPct.map((p) => (
                            <button
                              key={p.label}
                              type="button"
                              disabled={!position}
                              onClick={() => setAmount(p.value.toFixed(2))}
                              className="flex-1 rounded border border-pm-violet/15 bg-pm-violet/[0.06] py-1 text-[10px] text-pm-violet disabled:opacity-30"
                            >
                              {p.label}
                            </button>
                          ))}
                    </div>
                  </div>

                  {amount && (
                    <div className="mb-4 rounded-lg bg-white/[0.02] px-4 py-3.5">
                      <div className="mb-1.5 flex justify-between">
                        <span className="text-xs text-pm-text/40">{tab === "deposit" ? "PPS shares received" : "USDC received"}</span>
                        <span className="text-[13px] font-semibold text-pm-text">{tab === "deposit" ? sharesOut : usdcOut}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-pm-text/40">Estimated 30d yield</span>
                        <span className="text-xs font-semibold text-pm-green">
                          +{formatUsd(((parseFloat(amount || "0") * (pool?.apyBps ?? 890)) / 10000 / 12))}
                        </span>
                      </div>
                    </div>
                  )}

                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    block
                    loading={submission.status === "submitting" || wallet.status === "connecting"}
                    onClick={() => void handleSubmit()}
                  >
                    {wallet.status !== "connected"
                      ? "Connect Wallet"
                      : tab === "deposit"
                        ? "Provide Capital"
                        : "Withdraw USDC"}
                  </Button>

                  {submission.status === "error" && (
                    <p role="alert" className="mt-3 text-[12px] text-pm-red">
                      {submission.message}
                    </p>
                  )}

                  <div className="mt-4 rounded-md border border-pm-amber/15 bg-pm-amber/[0.06] px-3.5 py-3">
                    <p className="m-0 text-[11px] leading-relaxed text-pm-amber/90">
                      <Badge tone="risk" className="mr-1.5 align-middle">Risk</Badge>
                      Capital providers share in payout risk. If oracle triggers fire, pool capital covers claims
                      proportionally.
                    </p>
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

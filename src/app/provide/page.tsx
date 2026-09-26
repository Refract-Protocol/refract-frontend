"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Navbar, Footer } from "@/components/layout";
import { Container, Card, Badge, Input, Button, Skeleton } from "@/components/ui";
import { WalletButton } from "@/components/wallet";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { usePoolStats } from "@/hooks/usePoolStats";
import { useUserPoolPosition } from "@/hooks/useUserPoolPosition";
import { useLockupStatus } from "@/hooks/useLockupStatus";
import { provideCapital, withdrawCapital, type ProvideCapitalResponse, type WithdrawCapitalResponse } from "@/lib/api/pool";
import { ApiUnreachableError } from "@/lib/api/client";
import { formatUsd, fromStroops, toStroops } from "@/lib/format";
import { estimateYield, apyBpsToRate } from "@/lib/pool/yield";
import { signAndSubmit } from "@/lib/wallet/signAndSubmit";
import { truncateAddress } from "@/lib/wallet/WalletProvider";

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
  | { status: "signing" }
  | { status: "success"; kind: "deposit"; result: ProvideCapitalResponse; demo: boolean; txHash?: string }
  | { status: "success"; kind: "withdraw"; result: WithdrawCapitalResponse; demo: boolean; txHash?: string }
  | { status: "error"; message: string };

export default function ProvidePage() {
  const wallet = useWallet();
  const { data: pool, loading: poolLoading, isFixture: poolIsFixture } = usePoolStats();
  const { data: position } = useUserPoolPosition(wallet.status === "connected" ? wallet.address : null);
  const { lockupExpiresAt } = useLockupStatus(wallet.status === "connected" ? wallet.address : null);

  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [submission, setSubmission] = useState<SubmissionState>({ status: "idle" });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const sharePrice = pool?.sharePrice ?? 1;
  const userShares = position ? fromStroops(position.shares) : 0;
  const availableToWithdraw = userShares * sharePrice;

  const sharesOut = amount ? (parseFloat(amount) / sharePrice).toFixed(4) : "—";
  const usdcOut = amount ? (parseFloat(amount) * sharePrice).toFixed(2) : "—";

  const isLocked = lockupExpiresAt !== null && lockupExpiresAt * 1000 > Date.now();
  const withdrawInvalid =
    tab === "withdraw" && wallet.status === "connected" && parseFloat(amount || "0") > availableToWithdraw;

  const utilizationPct = pool ? pool.utilizationBps / 100 : 0;
  const maxUtilizationPct = pool ? pool.maxUtilizationBps / 100 : 80;

  // The pool APY tile and the 30-day estimate must agree, so both derive
  // from the same source value. When pool stats are unavailable we show an
  // explicit unavailable label rather than silently falling back to a
  // fixture number.
  const apyBps = pool?.apyBps;
  const apyAvailable = typeof apyBps === "number" && Number.isFinite(apyBps);
  const apyPct = apyAvailable ? apyBpsToRate(apyBps) * 100 : null;

  const parsedAmount = parseFloat(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const estimated30dYield =
    apyAvailable && amountValid ? estimateYield(parsedAmount, apyBps, 30) : null;

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
    if (tab === "withdraw" && parsed > availableToWithdraw) return;
    if (tab === "withdraw" && isLocked) return;

    setSubmission({ status: "submitting" });
    try {
      if (tab === "deposit") {
        const result = await provideCapital(wallet.address, toStroops(parsed));
        setSubmission({ status: "signing" });
        if (!wallet.networkPassphrase) {
          throw new Error("Wallet network isn't available — reconnect and try again");
        }
        const txHash = await signAndSubmit(result.txXdr, wallet.address, wallet.networkPassphrase);
        setSubmission({ status: "success", kind: "deposit", result, demo: false, txHash });
      } else {
        const result = await withdrawCapital(wallet.address, toStroops(parsed / sharePrice));
        setSubmission({ status: "signing" });
        if (!wallet.networkPassphrase) {
          throw new Error("Wallet network isn't available — reconnect and try again");
        }
        const txHash = await signAndSubmit(result.txXdr, wallet.address, wallet.networkPassphrase);
        setSubmission({ status: "success", kind: "withdraw", result, demo: false, txHash });
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
          <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-pm-text/40">Total Pool</div>
              {poolLoading ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                <div className="font-mono text-lg font-bold text-pm-text">
                  {pool ? formatUsd(fromStroops(pool.totalAssets)) : "—"}
                </div>
              )}
            </Card>
            <Card className="p-4">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-pm-text/40">30d APY</div>
              {poolLoading ? (
                <Skeleton className="h-6 w-16" />
              ) : (
                <div className="font-mono text-lg font-bold text-pm-green">
                  {apyPct !== null ? `${apyPct.toFixed(2)}%` : "—"}
                </div>
              )}
            </Card>
            <Card className="p-4">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-pm-text/40">Utilization</div>
              {poolLoading ? (
                <Skeleton className="h-6 w-16" />
              ) : (
                <div className="font-mono text-lg font-bold text-pm-text">{utilizationPct.toFixed(1)}%</div>
              )}
            </Card>
            <Card className="p-4">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-pm-text/40">Your Position</div>
              {wallet.status === "connected" ? (
                <div className="font-mono text-lg font-bold text-pm-text">{formatUsd(availableToWithdraw)}</div>
              ) : (
                <div className="text-sm text-pm-text/40">Connect wallet</div>
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <div>
              {/* Tabs */}
              <div className="mb-5 flex gap-1 rounded-xl border border-pm-border bg-pm-surface p-1">
                {(["deposit", "withdraw"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold capitalize transition-colors ${
                      tab === t ? "bg-pm-accent text-white" : "text-pm-text/50 hover:text-pm-text"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <Card className="p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-display text-lg font-bold text-pm-text">
                    {tab === "deposit" ? "Deposit USDC" : "Withdraw USDC"}
                  </h2>
                  {tab === "withdraw" && isLocked && (
                    <Badge tone="amber">Locked until {new Date(lockupExpiresAt! * 1000).toLocaleDateString()}</Badge>
                  )}
                </div>

                <label className="mb-1.5 block text-xs font-medium text-pm-text/50" htmlFor="provide-amount">
                  Amount (USDC)
                </label>
                <Input
                  id="provide-amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />

                {tab === "withdraw" && (
                  <div className="mt-3 flex gap-2">
                    {withdrawQuickPct.map((q) => (
                      <button
                        key={q.label}
                        onClick={() => setAmount(q.value.toFixed(2))}
                        className="rounded-lg border border-pm-border px-3 py-1 text-xs font-medium text-pm-text/60 hover:border-pm-accent hover:text-pm-text"
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-4 space-y-2 rounded-xl border border-pm-border bg-pm-bg/40 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-pm-text/45">{tab === "deposit" ? "Shares out" : "Shares in"}</span>
                    <span className="font-mono text-pm-text/80">{sharesOut}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-pm-text/45">{tab === "deposit" ? "Share price" : "USDC out"}</span>
                    <span className="font-mono text-pm-text/80">
                      {tab === "deposit" ? `$${sharePrice.toFixed(4)}` : usdcOut}
                    </span>
                  </div>
                  {tab === "deposit" && (
                    <div className="flex items-center justify-between">
                      <span className="text-pm-text/45">Estimated 30d yield</span>
                      <span
                        className="font-mono text-pm-green"
                        aria-live="polite"
                        aria-atomic="true"
                      >
                        {estimated30dYield !== null ? `+${formatUsd(estimated30dYield)}` : "—"}
                      </span>
                    </div>
                  )}
                </div>

                {tab === "deposit" && (
                  <p className="mt-2 text-[11px] leading-relaxed text-pm-text/40">
                    Estimate only, not guaranteed. Assumes the current pool APY holds for 30 days (30/365 of the
                    annual rate, simple interest) and that no coverage triggers fire.
                  </p>
                )}

                {withdrawInvalid && (
                  <p className="mt-3 text-xs text-pm-red">
                    Amount exceeds your withdrawable balance of {formatUsd(availableToWithdraw)}.
                  </p>
                )}

                {submission.status === "error" && (
                  <p className="mt-3 text-xs text-pm-red">{submission.message}</p>
                )}

                {submission.status === "success" && (
                  <div className="mt-4 rounded-xl border border-pm-green/30 bg-pm-green/5 p-3 text-xs text-pm-text/70">
                    {submission.demo ? (
                      <p>Simulated locally — the Refract API is unreachable in this environment.</p>
                    ) : (
                      <p>
                        {submission.kind === "deposit" ? "Deposit" : "Withdrawal"} submitted
                        {submission.txHash ? ` — ${truncateAddress(submission.txHash)}` : ""}.
                      </p>
                    )}
                  </div>
                )}

                <Button
                  className="mt-5 w-full"
                  onClick={handleSubmit}
                  disabled={
                    submission.status === "submitting" ||
                    submission.status === "signing" ||
                    withdrawInvalid ||
                    (tab === "withdraw" && isLocked)
                  }
                >
                  {wallet.status !== "connected"
                    ? "Connect Wallet"
                    : submission.status === "submitting" || submission.status === "signing"
                      ? "Processing…"
                      : tab === "deposit"
                        ? "Deposit"
                        : "Withdraw"}
                </Button>
              </Card>
            </div>

            <div className="space-y-5">
              <Card className="p-5">
                <h3 className="mb-3 font-display text-sm font-bold text-pm-text">Pool Allocation</h3>
                <div className="flex items-center gap-4">
                  <canvas ref={canvasRef} style={{ width: 160, height: 160 }} aria-hidden="true" />
                  <ul className="flex-1 space-y-1.5">
                    {RISK_BREAKDOWN.map((seg) => (
                      <li key={seg.type} className="flex items-center gap-2 text-[11px]">
                        <span className="h-2 w-2 rounded-full" style={{ background: seg.color }} />
                        <span className="flex-1 text-pm-text/55">{seg.type}</span>
                        <span className="font-mono text-pm-text/70">{seg.pct}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="mt-3 text-[11px] text-pm-text/35">
                  Illustrative allocation — the backend does not expose a per-category split.
                </p>
              </Card>

              <Card className="p-5">
                <h3 className="mb-2 font-display text-sm font-bold text-pm-text">Risk Disclosure</h3>
                <p className="text-[11px] leading-relaxed text-pm-text/45">
                  Providing capital is not risk-free. If a covered event triggers, pool capital is used to pay
                  claims and your position can lose value. Yields shown are estimates, not guarantees, and past
                  performance does not predict future results.
                </p>
              </Card>
            </div>
          </div>
        </Container>
      </main>

      <Footer />
    </div>
  );
}

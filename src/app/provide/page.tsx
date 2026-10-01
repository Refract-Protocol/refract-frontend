"use client";

import { useMemo, useState } from "react";
import { Navbar, Footer } from "@/components/layout";
import { Container, Card, Badge, Input, Button, Skeleton } from "@/components/ui";
import { ChartDonut } from "@/components/ui/ChartDonut";
import { WalletButton } from "@/components/wallet";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { usePoolStats } from "@/hooks/usePoolStats";
import { useUserPoolPosition } from "@/hooks/useUserPoolPosition";
import { useLockupStatus } from "@/hooks/useLockupStatus";
import { provideCapital, withdrawCapital, type ProvideCapitalResponse, type WithdrawCapitalResponse } from "@/lib/api/pool";
import { ApiUnreachableError } from "@/lib/api/client";
import { formatUsd, formatCompactUsd, formatSharePrice, fromStroops, toStroops } from "@/lib/format";
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

  // Illustrative risk breakdown passed to the accessible donut chart.
  const riskSegments = useMemo(
    () => RISK_BREAKDOWN.map((seg) => ({ label: seg.type, value: seg.pct, color: seg.color })),
    []
  );

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
              <div className="mb-1 text-[11px] uppercase tracking-wider text-pm-text/40">Pool TVL</div>
              {poolLoading ? (
                <Skeleton className="h-7 w-24" />
              ) : (
                <div className="font-display text-xl font-bold text-pm-text">
                  {formatCompactUsd(fromStroops(pool?.totalUsdc ?? "0"))}
                </div>
              )}
            </Card>
            <Card className="p-4">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-pm-text/40">Share Price</div>
              {poolLoading ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <div className="font-display text-xl font-bold text-pm-text">{formatSharePrice(sharePrice)}</div>
              )}
            </Card>
            <Card className="p-4">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-pm-text/40">Utilization</div>
              {poolLoading ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <div className="font-display text-xl font-bold text-pm-text">{utilizationPct.toFixed(1)}%</div>
              )}
            </Card>
            <Card className="p-4">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-pm-text/40">Your Position</div>
              {wallet.status !== "connected" ? (
                <div className="font-display text-xl font-bold text-pm-text/30">—</div>
              ) : (
                <div className="font-display text-xl font-bold text-pm-text">{formatUsd(availableToWithdraw)}</div>
              )}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            {/* Main panel */}
            <div className="space-y-6">
              <Card className="p-5 sm:p-6">
                <div className="mb-5 flex gap-1 rounded-lg bg-pm-bg/60 p-1">
                  {(["deposit", "withdraw"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setTab(t);
                        setAmount("");
                        setSubmission({ status: "idle" });
                      }}
                      className={`flex-1 rounded-md px-4 py-2 text-sm font-medium capitalize transition-colors ${
                        tab === t ? "bg-pm-violet text-white" : "text-pm-text/50 hover:text-pm-text"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <div className="mb-4">
                  <label className="mb-2 block text-xs font-medium text-pm-text/50">
                    {tab === "deposit" ? "Amount to deposit (USDC)" : "Amount to withdraw (USDC)"}
                  </label>
                  <div className="relative">
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="pr-16"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-medium text-pm-text/40">
                      USDC
                    </span>
                  </div>
                  {tab === "withdraw" && wallet.status === "connected" && (
                    <div className="mt-2 flex items-center justify-between text-[11px] text-pm-text/40">
                      <span>Available: {formatUsd(availableToWithdraw)}</span>
                      <div className="flex gap-1">
                        {withdrawQuickPct.map((q) => (
                          <button
                            key={q.label}
                            onClick={() => setAmount(q.value.toFixed(2))}
                            className="rounded px-2 py-0.5 text-[11px] text-pm-violet hover:bg-pm-violet/10"
                          >
                            {q.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {amount && parseFloat(amount) > 0 && (
                  <div className="mb-4 space-y-1.5 rounded-lg bg-pm-bg/60 p-3 text-xs">
                    {tab === "deposit" ? (
                      <div className="flex justify-between">
                        <span className="text-pm-text/40">Shares received</span>
                        <span className="font-mono text-pm-text">{sharesOut}</span>
                      </div>
                    ) : (
                      <div className="flex justify-between">
                        <span className="text-pm-text/40">USDC received</span>
                        <span className="font-mono text-pm-text">{usdcOut}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-pm-text/40">Share price</span>
                      <span className="font-mono text-pm-text">{formatSharePrice(sharePrice)}</span>
                    </div>
                  </div>
                )}

                {withdrawInvalid && (
                  <p className="mb-4 text-xs text-pm-red">Amount exceeds your available balance.</p>
                )}
                {tab === "withdraw" && isLocked && (
                  <p className="mb-4 text-xs text-pm-amber">
                    Your capital is locked until {new Date(lockupExpiresAt! * 1000).toLocaleDateString()}.
                  </p>
                )}

                <Button
                  onClick={handleSubmit}
                  disabled={
                    submission.status === "submitting" ||
                    submission.status === "signing" ||
                    !amount ||
                    parseFloat(amount) <= 0 ||
                    withdrawInvalid ||
                    (tab === "withdraw" && isLocked)
                  }
                  className="w-full"
                >
                  {submission.status === "submitting" || submission.status === "signing"
                    ? "Processing…"
                    : wallet.status !== "connected"
                    ? "Connect Wallet"
                    : tab === "deposit"
                    ? "Deposit"
                    : "Withdraw"}
                </Button>

                {submission.status === "success" && (
                  <div className="mt-4 rounded-lg border border-pm-green/30 bg-pm-green/5 p-3 text-xs">
                    <p className="font-medium text-pm-green">
                      {submission.kind === "deposit" ? "Deposit" : "Withdrawal"} submitted
                      {submission.demo ? " (simulated)" : ""}
                    </p>
                    {submission.txHash && (
                      <p className="mt-1 font-mono text-pm-text/50">{truncateAddress(submission.txHash)}</p>
                    )}
                  </div>
                )}
                {submission.status === "error" && (
                  <p className="mt-4 text-xs text-pm-red">{submission.message}</p>
                )}
              </Card>

              <Card className="p-5 sm:p-6">
                <h2 className="mb-4 font-display text-sm font-bold text-pm-text">Pool Allocation</h2>
                <div className="flex flex-col items-center gap-6 sm:flex-row">
                  <canvas ref={canvasRef} style={{ width: 160, height: 160 }} />
                  <div className="flex-1 space-y-2">
                    {RISK_BREAKDOWN.map((seg) => (
                      <div key={seg.type} className="flex items-center gap-2 text-xs">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: seg.color }} />
                        <span className="flex-1 text-pm-text/60">{seg.type}</span>
                        <span className="font-mono text-pm-text">{seg.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              <Card className="p-5">
                <h2 className="mb-4 font-display text-sm font-bold text-pm-text">Capital Allocation</h2>
                <div className="flex items-center gap-5">
                  <ChartDonut
                    segments={riskSegments}
                    ariaLabel="Capital allocation by coverage category"
                  />
                  <ul className="flex-1 space-y-2">
                    {RISK_BREAKDOWN.map((seg) => (
                      <li key={seg.type} className="flex items-center gap-2 text-xs text-pm-text/60">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
                        <span className="flex-1">{seg.type}</span>
                        <span className="font-medium text-pm-text/80">{seg.pct}%</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <h2 className="mb-4 mt-6 font-display text-sm font-bold text-pm-text">Pool Stats</h2>
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-pm-text/40">Total capital</span>
                    <span className="font-mono text-pm-text">
                      {formatCompactUsd(fromStroops(pool?.totalUsdc ?? "0"))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-pm-text/40">Locked capital</span>
                    <span className="font-mono text-pm-text">
                      {formatCompactUsd(fromStroops(pool?.lockedUsdc ?? "0"))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-pm-text/40">Share price</span>
                    <span className="font-mono text-pm-text">{formatSharePrice(sharePrice)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-pm-text/40">Utilization</span>
                    <span className="font-mono text-pm-text">
                      {utilizationPct.toFixed(1)}% / {maxUtilizationPct.toFixed(0)}%
                    </span>
                  </div>
                </div>
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="mb-3 font-display text-sm font-bold text-pm-text">Pool Health</h2>
                <div className="space-y-3 text-xs">
                  <div>
                    <div className="mb-1 flex justify-between text-pm-text/50">
                      <span>Utilization</span>
                      <span className="text-pm-text/80">
                        {utilizationPct.toFixed(1)}% / {maxUtilizationPct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-pm-bg/60">
                      <div
                        className="h-full rounded-full bg-pm-violet"
                        style={{ width: `${Math.min(100, (utilizationPct / maxUtilizationPct) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-pm-text/50">Status</span>
                    <Badge tone={utilizationPct >= maxUtilizationPct ? "amber" : "green"}>
                      {utilizationPct >= maxUtilizationPct ? "At capacity" : "Accepting capital"}
                    </Badge>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </Container>
      </main>

      <Footer />
    </div>
  );
}

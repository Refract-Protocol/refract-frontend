"use client";

import { useState, useEffect, useRef } from "react";
import { Navbar, Footer } from "@/components/layout";
import { Container, Button, Badge, Card, Skeleton } from "@/components/ui";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useOracleStatus } from "@/hooks/useOracleStatus";
import { useRecentClaims } from "@/hooks/useRecentClaims";
import { useProtocolStats } from "@/hooks/useProtocolStats";
import type { OracleReading } from "@/lib/api/oracle";
import type { BadgeTone } from "@/components/ui/Badge";
import { formatUsd, formatRelativeTime, fromStroops } from "@/lib/format";
import { truncateAddress } from "@/lib/wallet/WalletProvider";
import { ACTIVE_NETWORK } from "@/lib/network";
import { HowItWorks } from "@/components/HowItWorks";
import { RealtimeBoundary } from "@/components/realtime/RealtimeBoundary";
import { RealtimeProfiler } from "@/lib/realtime/devProfiler";

function Counter({ to, prefix = "", suffix = "", decimals = 0 }: { to: number; prefix?: string; suffix?: string; decimals?: number }) {
  const [val, setVal] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      setVal(to);
      return;
    }
    const duration = 2000;
    const start = performance.now();
    const from = val;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setVal(from + (to - from) * ease);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, reducedMotion]);
  return <>{prefix}{val.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>;
}

const COVERAGE_TYPES = [
  { icon: "🪙", name: "Stablecoin Depeg", desc: "Auto-pays if USDC breaks $0.95 peg", color: "#8b5cf6", risk: "Medium" },
  { icon: "📉", name: "Market Crash", desc: "Covers 30%+ drawdown in 24 hours", color: "#f59e0b", risk: "High" },
  { icon: "🛡️", name: "Liquidation Shield", desc: "Saves your DeFi position from liquidation loss", color: "#10b981", risk: "High" },
  { icon: "🔐", name: "Smart Contract Risk", desc: "Protocol hack or exploit coverage", color: "#ef4444", risk: "Critical" },
  { icon: "✈️", name: "Flight Delay", desc: "Instant payout for 2hr+ flight delays", color: "#06b6d4", risk: "Low" },
];

const COVERAGE_NAME_BY_TYPE = COVERAGE_TYPES.map((c) => c.name);

const ORACLE_FEED_DISPLAY: Record<string, { feed: string; icon: string; formatValue: (r: OracleReading) => string }> = {
  StablecoinDepeg: { feed: "USDC/USD", icon: "🪙", formatValue: (r) => `$${r.value.toFixed(4)}` },
  MarketCrash: { feed: "Market 24h", icon: "📊", formatValue: (r) => `${r.value >= 0 ? "+" : ""}${r.value.toFixed(2)}%` },
  SmartContractRisk: { feed: "Protocol TVL 24h", icon: "🔐", formatValue: (r) => `${r.value >= 0 ? "+" : ""}${r.value.toFixed(2)}%` },
};

const SEVERITY_BADGE_TONE: Record<OracleReading["severity"], BadgeTone> = {
  low: "safe",
  medium: "risk",
  high: "danger",
  triggered: "danger",
};

const TRIGGER_DETAILS = [
  "USDC price < $0.95 for 15+ min",
  "Market index -30% in 24h",
  "Collateral ratio < 85%",
  "Protocol TVL drops >50% in 1hr",
  "Flight delayed >120 min (AviationStack)",
];

export default function Home() {
  const [activeType, setActiveType] = useState(0);
  const tabRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const ct = COVERAGE_TYPES[activeType];
  const oracleStatus = useOracleStatus();
  const recentClaims = useRecentClaims();
  const protocolStats = useProtocolStats();
  const statsLoading = protocolStats.loading;
  const anyTriggered = oracleStatus.data?.some((r) => r.severity === "triggered") ?? false;
  const [secondsAgo, setSecondsAgo] = useState(0);

  useEffect(() => {
    if (!oracleStatus.lastUpdated) return;
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - (oracleStatus.lastUpdated?.getTime() ?? Date.now())) / 1000);
      setSecondsAgo(Math.max(0, diff));
    }, 1000);
    return () => clearInterval(interval);
  }, [oracleStatus.lastUpdated]);

  return (
    <div className="min-h-screen bg-pm-bg">
      <Navbar
        right={
          <>
            <Button href="/cover" variant="outline" size="sm">Get Coverage</Button>
            <Button href="/provide" variant="primary" size="sm">Provide Capital</Button>
          </>
        }
      />

      <main id="main-content">
        {/* Hero */}
        <Container as="section" className="grid grid-cols-1 items-center gap-12 py-16 sm:py-20 lg:grid-cols-[1fr_420px] lg:gap-16 lg:py-24">
          <div>
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-pm-violet/25 bg-pm-violet/10 px-3.5 py-1.5">
              <span className="h-[7px] w-[7px] rounded-full bg-pm-green shadow-[0_0_8px_#10b981]" aria-hidden="true" />
              <span className="text-xs font-medium text-pm-text/70">Live on {ACTIVE_NETWORK.label}</span>
            </div>

            <h1 className="mb-5 font-display text-[clamp(34px,7vw,60px)] font-extrabold leading-[1.05] tracking-tight text-pm-text">
              Parametric insurance
              <br />
              <span className="bg-gradient-to-br from-[#8b5cf6] to-[#c4b5fd] bg-clip-text text-transparent">
                that pays itself.
              </span>
            </h1>

            <p className="mb-9 max-w-[520px] text-[17px] leading-[1.7] text-pm-text/55">
              No claims. No adjusters. No waiting. When an oracle confirms your trigger condition on-chain, Refract
              automatically transfers your payout. Trustless coverage for DeFi, markets, and real-world events.
            </p>

            <div className="flex flex-col gap-3.5 xs:flex-row">
              <Button href="/cover" variant="primary" size="lg">Get Covered →</Button>
              <Button href="/provide" variant="ghost" size="lg">Earn Premiums</Button>
            </div>

            {/* Stats */}
            <div className="mt-12 border-t border-pm-border pt-4">
              <div className="mb-2 flex justify-end">
                <button type="button" onClick={() => void protocolStats.refresh()} disabled={protocolStats.isRefreshing} aria-label="Refresh protocol statistics" className="text-[11px] text-pm-text/40 hover:text-pm-text disabled:opacity-50">
                  {protocolStats.isRefreshing ? "Refreshing…" : "Refresh statistics ↻"}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-8 xs:grid-cols-3">
                {[
                  {
                    val: protocolStats.data ? fromStroops(protocolStats.data.tvl) : 0,
                    prefix: "$",
                    suffix: "",
                    label: "Total Value Protected",
                    dec: 0,
                    payout: false,
                  },
                  {
                    val: 0,
                    prefix: "",
                    suffix: "",
                    label: "Cumulative Payouts",
                    dec: 0,
                    payout: true,
                  },
                  {
                    val: protocolStats.data?.activePolicies ?? 0,
                    prefix: "",
                    suffix: "",
                    label: "Policies Active",
                    dec: 0,
                    payout: false,
                  },
                ].map((s) => (
                  <div key={s.label}>
                    <div className="min-h-[31px] font-display tabular-nums text-[26px] font-extrabold tracking-tight text-pm-text sm:text-[28px]">
                      {statsLoading ? (
                        <Skeleton height={26} width={90} />
                      ) : (
                        <Counter key="loaded" to={s.payout ? fromStroops(protocolStats.data?.cumulativePayouts ?? "0") : s.val} prefix={s.payout ? "$" : s.prefix} suffix={s.suffix} decimals={s.dec} />
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-pm-text/40">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Hero right: Live coverage card */}
          <div className="relative">
            <RealtimeBoundary topic="oracle_update" route="/" fallback={() => <Card className="relative z-10" aria-label="Live oracle status"><p role="status">Live oracle readings are unavailable. Other Refract sections remain available.</p></Card>}>
            <RealtimeProfiler topic="oracle_update"><Card className="relative z-10" aria-label="Live oracle status">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-pm-text/60">Live Oracle Status</span>
                  <button
                    type="button"
                    onClick={() => void oracleStatus.refresh()}
                    disabled={oracleStatus.isRefreshing}
                    className="flex h-5 w-5 items-center justify-center rounded text-xs text-pm-text/40 hover:bg-white/[0.06] hover:text-pm-text transition-colors disabled:opacity-50"
                    title="Refresh oracle readings"
                    aria-label="Refresh oracle status"
                  >
                    <span className={`inline-block ${oracleStatus.isRefreshing ? "animate-spin" : ""}`}>
                      ↻
                    </span>
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`pm-glow h-[7px] w-[7px] rounded-full ${anyTriggered ? "bg-pm-red" : "bg-pm-green"}`}
                    aria-hidden="true"
                  />
                  <span className={`text-[11px] font-semibold ${anyTriggered ? "text-pm-red" : "text-pm-green"}`}>
                    {anyTriggered ? "Trigger active" : "All systems nominal"}
                  </span>
                </div>
              </div>

              <ul>
                {(oracleStatus.data ?? []).map((reading) => {
                  const display = ORACLE_FEED_DISPLAY[reading.coverageType];
                  if (!display) return null;
                  return (
                    <li
                      key={reading.coverageType}
                      className="flex items-center justify-between border-b border-pm-violet/[0.08] py-3 last:border-none transition-colors duration-300"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base" aria-hidden="true">{display.icon}</span>
                        <span className="text-[13px] text-pm-text/70">{display.feed}</span>
                      </div>
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-[13px] font-semibold text-pm-text transition-all">
                          {display.formatValue(reading)}
                        </span>
                        <Badge tone={SEVERITY_BADGE_TONE[reading.severity]}>
                          {reading.severity === "low" ? "Safe" : reading.severity === "triggered" ? "Triggered" : "Elevated"}
                        </Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div
                className={`mt-5 rounded-lg border px-3.5 py-3 ${
                  anyTriggered ? "border-pm-red/15 bg-pm-red/[0.06]" : "border-pm-green/15 bg-pm-green/[0.06]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className={`text-xs font-semibold ${anyTriggered ? "text-pm-red" : "text-pm-green"}`}>
                    {anyTriggered ? "One or more triggers active" : "No triggers active"}
                  </div>
                  {oracleStatus.lastUpdated && (
                    <span className="text-[10px] text-pm-text/40">
                      {secondsAgo === 0 ? "Just updated" : `${secondsAgo}s ago`}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-pm-text/40">
                  {oracleStatus.isFixture
                    ? "Example data — Refract API unreachable"
                    : oracleStatus.isStale
                      ? "Live feed interrupted — showing last known data, refreshing every 60 seconds"
                      : "Oracles auto-refreshed every 60 seconds"}
                </div>
              </div>
            </Card></RealtimeProfiler>
            </RealtimeBoundary>
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 -z-0 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-pm-violet/[0.12] blur-[60px]"
              aria-hidden="true"
            />
          </div>
        </Container>

        {/* Coverage Types */}
        <section aria-labelledby="coverage-heading" className="border-y border-pm-border/60 bg-pm-violet/[0.02] py-16">
          <Container>
            <div className="mb-10 text-center">
              <h2 id="coverage-heading" className="mb-3 font-display text-[28px] font-extrabold tracking-tight text-pm-text sm:text-[32px]">
                Five coverage categories
              </h2>
              <p className="mx-auto max-w-[500px] text-[15px] text-pm-text/45">
                Each policy is backed by real capital in the Refract risk pool and settles automatically via oracle proof.
              </p>
            </div>

            <div
              className="mb-8 flex flex-wrap justify-center gap-2.5"
              role="tablist"
              aria-label="Coverage category"
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
                e.preventDefault();
                let next = activeType;
                if (e.key === "ArrowLeft") next = (activeType - 1 + COVERAGE_TYPES.length) % COVERAGE_TYPES.length;
                if (e.key === "ArrowRight") next = (activeType + 1) % COVERAGE_TYPES.length;
                if (e.key === "Home") next = 0;
                if (e.key === "End") next = COVERAGE_TYPES.length - 1;
                setActiveType(next);
                tabRefs.current[next]?.focus();
              }}
            >
              {COVERAGE_TYPES.map((t, i) => (
                <button
                  key={t.name}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={activeType === i}
                  tabIndex={activeType === i ? 0 : -1}
                  onClick={() => setActiveType(i)}
                  className="rounded-lg border px-4 py-2 text-[13px] font-medium transition-colors"
                  style={{
                    borderColor: activeType === i ? t.color : "rgba(139,92,246,0.15)",
                    background: activeType === i ? `${t.color}18` : "transparent",
                    color: activeType === i ? t.color : "rgba(240,236,255,0.5)",
                  }}
                >
                  {t.icon} {t.name}
                </button>
              ))}
            </div>

            <Card padding="lg">
              <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2">
                <div>
                  <div className="mb-4 text-4xl" aria-hidden="true">{ct.icon}</div>
                  <h3 className="mb-3 font-display text-2xl font-extrabold tracking-tight text-pm-text">{ct.name}</h3>
                  <p className="mb-6 text-[15px] leading-[1.7] text-pm-text/55">{ct.desc}</p>
                  <div className="flex flex-wrap gap-2.5">
                    <Badge tone={activeType === 3 ? "danger" : activeType >= 1 ? "risk" : "safe"}>{ct.risk} Risk</Badge>
                    <Badge tone="violet">Auto-Settle</Badge>
                    <Badge tone="violet">No Claims Form</Badge>
                  </div>
                  <div className="mt-6">
                    <Button href="/cover" variant="primary">Buy This Coverage</Button>
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  {[
                    { label: "How it triggers", value: TRIGGER_DETAILS[activeType] },
                    { label: "Settlement time", value: "< 60 seconds after oracle confirms" },
                    { label: "Oracle source", value: activeType === 4 ? "AviationStack API + Refract relay" : "Band Protocol + Pyth Network" },
                    { label: "Dispute process", value: "None — oracle data is final and immutable" },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg bg-white/[0.02] px-5 py-4" style={{ borderLeft: `3px solid ${ct.color}` }}>
                      <div className="mb-1 text-[11px] uppercase tracking-wide text-pm-text/40">{item.label}</div>
                      <div className="text-[13px] font-medium text-pm-text">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </Container>
        </section>

        {/* Scroll-driven How it works section */}
        <HowItWorks />

        {/* Recent payouts */}
        <RealtimeBoundary topic="claim_settlement" route="/" fallback={() => <section aria-labelledby="payouts-heading" className="py-16"><Container><h2 id="payouts-heading" className="font-display text-2xl font-extrabold text-pm-text">Recent payouts</h2><p role="status" className="mt-3 text-sm text-pm-text/50">Payout updates are temporarily unavailable.</p></Container></section>}>
        <RealtimeProfiler topic="claim_settlement"><section aria-labelledby="payouts-heading" className="py-16">
          <Container>
            <div className="mb-7 flex items-center justify-between">
              <h2 id="payouts-heading" className="font-display text-2xl font-extrabold tracking-tight text-pm-text sm:text-[26px]">Recent payouts</h2>
              <button type="button" onClick={() => void recentClaims.refresh()} disabled={recentClaims.isRefreshing} className="text-[11px] text-pm-text/40 hover:text-pm-text disabled:opacity-50">Refresh ↻</button>
            </div>
            {recentClaims.isFixture && (
              <p className="mb-4 inline-flex items-center gap-1.5 text-[11px] text-pm-amber">
                ⚠ Showing example data — the Refract API isn&apos;t reachable from this environment.
              </p>
            )}
            {recentClaims.isStale && <p className="mb-4 text-[11px] text-pm-text/40">Saved payouts — refreshing live data…</p>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(recentClaims.data ?? []).map((claim) => (
                <Card key={claim.policyId} padding="sm" className="!p-5">
                  <div className="mb-3 flex items-start justify-between">
                    <Badge tone="violet">{COVERAGE_NAME_BY_TYPE[claim.coverageType] ?? "Unknown"}</Badge>
                    <span className="text-[11px] text-pm-text/35">{formatRelativeTime(claim.processedAt)}</span>
                  </div>
                  <div className="mb-2 font-display text-2xl font-extrabold tracking-tight text-pm-green">
                    {formatUsd(fromStroops(claim.payout))}
                  </div>
                  <div className="font-mono text-[11px] text-pm-text/35">
                    tx: {claim.settlementTxHash ? truncateAddress(claim.settlementTxHash, 3, 3) : "pending"}
                  </div>
                </Card>
              ))}
            </div>
          </Container>
        </section></RealtimeProfiler>
        </RealtimeBoundary>
      </main>

      <Footer />
    </div>
  );
}

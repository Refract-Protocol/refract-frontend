"use client";

import { useState, useEffect, useRef } from "react";
import { Navbar, Footer } from "@/components/layout";
import { Container, Button, Badge, Card } from "@/components/ui";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

function Counter({ to, prefix = "", suffix = "", decimals = 0 }: { to: number; prefix?: string; suffix?: string; decimals?: number }) {
  const [val, setVal] = useState(0);
  const ref = useRef(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (ref.current) return;
    ref.current = true;

    if (reducedMotion) {
      setVal(to);
      return;
    }

    const duration = 2000;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setVal(ease * to);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
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

const RECENT_PAYOUTS = [
  { type: "Stablecoin Depeg", amount: "$48,200", time: "3 days ago", tx: "abc...def" },
  { type: "Market Crash", amount: "$120,000", time: "11 days ago", tx: "xyz...123" },
  { type: "Flight Delay", amount: "$1,400", time: "2 weeks ago", tx: "qrs...789" },
];

const ORACLE_FEEDS = [
  { feed: "USDC/USD", value: "$1.0002", icon: "🪙" },
  { feed: "Market 24h", value: "-1.4%", icon: "📊" },
  { feed: "BTC Crash Index", value: "0.08", icon: "📉" },
  { feed: "Aave Collateral", value: "92.1%", icon: "🏦" },
];

const TRIGGER_DETAILS = [
  "USDC price < $0.95 for 15+ min",
  "Market index -30% in 24h",
  "Collateral ratio < 85%",
  "Protocol TVL drops >50% in 1hr",
  "Flight delayed >120 min (AviationStack)",
];

export default function Home() {
  const [activeType, setActiveType] = useState(0);
  const ct = COVERAGE_TYPES[activeType];

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
              <span className="text-xs font-medium text-pm-text/70">Live on Stellar Testnet</span>
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
            <div className="mt-12 grid grid-cols-1 gap-8 border-t border-pm-border pt-8 xs:grid-cols-3">
              {[
                { val: 18_400_000, prefix: "$", suffix: "", label: "Total Value Protected", dec: 0 },
                { val: 8.9, prefix: "", suffix: "% APY", label: "Capital Provider Returns", dec: 1 },
                { val: 247, prefix: "", suffix: "", label: "Policies Active", dec: 0 },
              ].map((s) => (
                <div key={s.label}>
                  <div className="font-display text-[26px] font-extrabold tracking-tight text-pm-text sm:text-[28px]">
                    <Counter to={s.val} prefix={s.prefix} suffix={s.suffix} decimals={s.dec} />
                  </div>
                  <div className="mt-0.5 text-xs text-pm-text/40">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Hero right: Live coverage card */}
          <div className="relative">
            <Card className="relative z-10" aria-label="Live oracle status">
              <div className="mb-6 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wide text-pm-text/60">Live Oracle Status</span>
                <div className="flex items-center gap-1.5">
                  <span className="pm-glow h-[7px] w-[7px] rounded-full bg-pm-green" aria-hidden="true" />
                  <span className="text-[11px] font-semibold text-pm-green">All systems nominal</span>
                </div>
              </div>

              <ul>
                {ORACLE_FEEDS.map((item) => (
                  <li key={item.feed} className="flex items-center justify-between border-b border-pm-violet/[0.08] py-3 last:border-none">
                    <div className="flex items-center gap-2.5">
                      <span className="text-base" aria-hidden="true">{item.icon}</span>
                      <span className="text-[13px] text-pm-text/70">{item.feed}</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-[13px] font-semibold text-pm-text">{item.value}</span>
                      <Badge tone="safe">Safe</Badge>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-5 rounded-lg border border-pm-green/15 bg-pm-green/[0.06] px-3.5 py-3">
                <div className="mb-0.5 text-xs font-semibold text-pm-green">No triggers active</div>
                <div className="text-[11px] text-pm-text/40">Oracles refreshed every 60 seconds</div>
              </div>
            </Card>
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

            <div className="mb-8 flex flex-wrap justify-center gap-2.5" role="tablist" aria-label="Coverage category">
              {COVERAGE_TYPES.map((t, i) => (
                <button
                  key={t.name}
                  role="tab"
                  aria-selected={activeType === i}
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

        {/* Recent payouts */}
        <section aria-labelledby="payouts-heading" className="py-16">
          <Container>
            <h2 id="payouts-heading" className="mb-7 font-display text-2xl font-extrabold tracking-tight text-pm-text sm:text-[26px]">
              Recent payouts
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {RECENT_PAYOUTS.map((p) => (
                <Card key={p.tx} padding="sm" className="!p-5">
                  <div className="mb-3 flex items-start justify-between">
                    <Badge tone="violet">{p.type}</Badge>
                    <span className="text-[11px] text-pm-text/35">{p.time}</span>
                  </div>
                  <div className="mb-2 font-display text-2xl font-extrabold tracking-tight text-pm-green">{p.amount}</div>
                  <div className="font-mono text-[11px] text-pm-text/35">tx: {p.tx}</div>
                </Card>
              ))}
            </div>
          </Container>
        </section>
      </main>

      <Footer />
    </div>
  );
}

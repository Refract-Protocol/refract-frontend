"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

function Counter({ to, prefix = "", suffix = "", decimals = 0 }: { to: number; prefix?: string; suffix?: string; decimals?: number }) {
  const [val, setVal] = useState(0);
  const ref = useRef(false);
  useEffect(() => {
    if (ref.current) return;
    ref.current = true;
    const duration = 2000;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setVal(ease * to);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [to]);
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

export default function Home() {
  const [activeType, setActiveType] = useState(0);

  return (
    <div style={{ minHeight: "100vh", background: "var(--pm-bg)" }}>
      {/* Navbar */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 28px", height: 64,
        background: "rgba(7,5,15,0.85)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(139,92,246,0.12)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <div style={{
              width: 32, height: 32,
              background: "linear-gradient(135deg,#8b5cf6,#5b21b6)",
              borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 16px rgba(139,92,246,0.4)",
            }}>
              <span style={{ color: "#fff", fontSize: 16 }}>⬡</span>
            </div>
            <span style={{ color: "#f0ecff", fontWeight: 800, fontSize: 18, fontFamily: "Syne, sans-serif", letterSpacing: "-0.02em" }}>Refract</span>
          </Link>
          {[{ label: "Coverage", href: "/cover" }, { label: "Provide Capital", href: "/provide" }, { label: "Docs", href: "#" }].map(item => (
            <Link key={item.label} href={item.href} style={{ color: "rgba(240,236,255,0.55)", fontSize: 14, textDecoration: "none", fontWeight: 500, transition: "color 0.15s" }}>
              {item.label}
            </Link>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/cover" className="pm-btn-outline" style={{ fontSize: 13, padding: "7px 18px" }}>Get Coverage</Link>
          <Link href="/provide" className="pm-btn-primary" style={{ fontSize: 13, padding: "7px 18px" }}>Provide Capital</Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ padding: "88px 28px 80px", maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 420px", gap: 64, alignItems: "center" }}>
        <div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)",
            borderRadius: 40, padding: "6px 14px", marginBottom: 28,
          }}>
            <span style={{ width: 7, height: 7, background: "#10b981", borderRadius: "50%", boxShadow: "0 0 8px #10b981" }} />
            <span style={{ color: "rgba(240,236,255,0.7)", fontSize: 12, fontWeight: 500 }}>Live on Stellar Testnet</span>
          </div>

          <h1 style={{
            fontFamily: "Syne, sans-serif", fontSize: "clamp(36px, 5vw, 60px)",
            fontWeight: 800, lineHeight: 1.05,
            color: "#f0ecff", margin: "0 0 20px",
            letterSpacing: "-0.03em",
          }}>
            Parametric insurance<br />
            <span style={{ background: "linear-gradient(135deg,#8b5cf6,#c4b5fd)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              that pays itself.
            </span>
          </h1>

          <p style={{ color: "rgba(240,236,255,0.55)", fontSize: 17, lineHeight: 1.7, maxWidth: 520, margin: "0 0 36px" }}>
            No claims. No adjusters. No waiting. When an oracle confirms your trigger condition on-chain, Refract automatically transfers your payout. Trustless coverage for DeFi, markets, and real-world events.
          </p>

          <div style={{ display: "flex", gap: 14 }}>
            <Link href="/cover" className="pm-btn-primary" style={{ fontSize: 15, padding: "13px 28px" }}>
              Get Covered →
            </Link>
            <Link href="/provide" className="pm-btn-ghost" style={{ fontSize: 15, padding: "13px 28px" }}>
              Earn Premiums
            </Link>
          </div>

          {/* Stats */}
          <div style={{ display: "flex", gap: 32, marginTop: 52, paddingTop: 32, borderTop: "1px solid rgba(139,92,246,0.12)" }}>
            {[
              { val: 18_400_000, prefix: "$", suffix: "", label: "Total Value Protected", dec: 0 },
              { val: 8.9, prefix: "", suffix: "% APY", label: "Capital Provider Returns", dec: 1 },
              { val: 247, prefix: "", suffix: "", label: "Policies Active", dec: 0 },
            ].map(s => (
              <div key={s.label}>
                <div style={{ color: "#f0ecff", fontSize: 28, fontWeight: 800, fontFamily: "Syne, sans-serif", letterSpacing: "-0.02em" }}>
                  <Counter to={s.val} prefix={s.prefix} suffix={s.suffix} decimals={s.dec} />
                </div>
                <div style={{ color: "rgba(240,236,255,0.4)", fontSize: 12, marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Hero right: Live coverage card */}
        <div style={{ position: "relative" }}>
          <div className="pm-panel" style={{ padding: 28, position: "relative", zIndex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <span style={{ color: "rgba(240,236,255,0.6)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>Live Oracle Status</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 7, height: 7, background: "#10b981", borderRadius: "50%", boxShadow: "0 0 6px #10b981", animation: "shieldPulse 2s infinite" }} />
                <span style={{ color: "#10b981", fontSize: 11, fontWeight: 600 }}>All systems nominal</span>
              </div>
            </div>

            {[
              { feed: "USDC/USD", value: "$1.0002", status: "safe", icon: "🪙" },
              { feed: "Market 24h", value: "-1.4%", status: "safe", icon: "📊" },
              { feed: "BTC Crash Index", value: "0.08", status: "safe", icon: "📉" },
              { feed: "Aave Collateral", value: "92.1%", status: "safe", icon: "🏦" },
            ].map(item => (
              <div key={item.feed} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid rgba(139,92,246,0.08)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 16 }}>{item.icon}</span>
                  <span style={{ color: "rgba(240,236,255,0.7)", fontSize: 13 }}>{item.feed}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ color: "#f0ecff", fontSize: 13, fontFamily: "monospace", fontWeight: 600 }}>{item.value}</span>
                  <span className="pm-tag pm-tag-safe">Safe</span>
                </div>
              </div>
            ))}

            <div style={{ marginTop: 20, padding: "12px 14px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: 8 }}>
              <div style={{ color: "#10b981", fontSize: 12, fontWeight: 600, marginBottom: 2 }}>No triggers active</div>
              <div style={{ color: "rgba(240,236,255,0.4)", fontSize: 11 }}>Oracles refreshed every 60 seconds</div>
            </div>
          </div>
          {/* Background glow */}
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 300, height: 300, background: "rgba(139,92,246,0.12)", borderRadius: "50%", filter: "blur(60px)", zIndex: 0 }} />
        </div>
      </section>

      {/* Coverage Types */}
      <section style={{ padding: "64px 28px", borderTop: "1px solid rgba(139,92,246,0.08)", borderBottom: "1px solid rgba(139,92,246,0.08)", background: "rgba(139,92,246,0.02)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 32, fontWeight: 800, color: "#f0ecff", marginBottom: 12, letterSpacing: "-0.02em" }}>Five coverage categories</h2>
            <p style={{ color: "rgba(240,236,255,0.45)", fontSize: 15, maxWidth: 500, margin: "0 auto" }}>Each policy is backed by real capital in the Refract risk pool and settles automatically via oracle proof.</p>
          </div>

          <div style={{ display: "flex", gap: 12, marginBottom: 32, justifyContent: "center" }}>
            {COVERAGE_TYPES.map((t, i) => (
              <button key={i} onClick={() => setActiveType(i)} style={{
                padding: "8px 16px", borderRadius: 8, border: "1px solid",
                borderColor: activeType === i ? t.color : "rgba(139,92,246,0.15)",
                background: activeType === i ? `${t.color}18` : "transparent",
                color: activeType === i ? t.color : "rgba(240,236,255,0.5)",
                fontSize: 13, fontWeight: 500, cursor: "pointer", transition: "all 0.15s",
              }}>{t.icon} {t.name}</button>
            ))}
          </div>

          <div className="pm-panel" style={{ padding: 32 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 40, marginBottom: 16 }}>{COVERAGE_TYPES[activeType].icon}</div>
                <h3 style={{ fontFamily: "Syne, sans-serif", fontSize: 24, fontWeight: 800, color: "#f0ecff", marginBottom: 12, letterSpacing: "-0.02em" }}>{COVERAGE_TYPES[activeType].name}</h3>
                <p style={{ color: "rgba(240,236,255,0.55)", fontSize: 15, lineHeight: 1.7, marginBottom: 24 }}>{COVERAGE_TYPES[activeType].desc}</p>
                <div style={{ display: "flex", gap: 10 }}>
                  <span className={`pm-tag pm-tag-${activeType === 3 ? "danger" : activeType >= 1 ? "risk" : "safe"}`}>{COVERAGE_TYPES[activeType].risk} Risk</span>
                  <span className="pm-tag pm-tag-violet">Auto-Settle</span>
                  <span className="pm-tag pm-tag-violet">No Claims Form</span>
                </div>
                <Link href="/cover" className="pm-btn-primary" style={{ display: "inline-block", marginTop: 24, fontSize: 14, padding: "10px 22px", textDecoration: "none" }}>
                  Buy This Coverage
                </Link>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { label: "How it triggers", value: activeType === 0 ? "USDC price < $0.95 for 15+ min" : activeType === 1 ? "Market index -30% in 24h" : activeType === 2 ? "Collateral ratio < 85%" : activeType === 3 ? "Protocol TVL drops >50% in 1hr" : "Flight delayed >120 min (AviationStack)" },
                  { label: "Settlement time", value: "< 60 seconds after oracle confirms" },
                  { label: "Oracle source", value: activeType === 4 ? "AviationStack API + Refract relay" : "Band Protocol + Pyth Network" },
                  { label: "Dispute process", value: "None — oracle data is final and immutable" },
                ].map(item => (
                  <div key={item.label} style={{ padding: "16px 20px", background: "rgba(255,255,255,0.02)", borderRadius: 8, borderLeft: `3px solid ${COVERAGE_TYPES[activeType].color}` }}>
                    <div style={{ color: "rgba(240,236,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{item.label}</div>
                    <div style={{ color: "#f0ecff", fontSize: 13, fontWeight: 500 }}>{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Recent payouts */}
      <section style={{ padding: "64px 28px", maxWidth: 1200, margin: "0 auto" }}>
        <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 26, fontWeight: 800, color: "#f0ecff", marginBottom: 28, letterSpacing: "-0.02em" }}>Recent payouts</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
          {RECENT_PAYOUTS.map((p, i) => (
            <div key={i} className="pm-panel" style={{ padding: "20px 24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                <span className="pm-tag pm-tag-violet">{p.type}</span>
                <span style={{ color: "rgba(240,236,255,0.35)", fontSize: 11 }}>{p.time}</span>
              </div>
              <div style={{ color: "#10b981", fontSize: 24, fontWeight: 800, fontFamily: "Syne, sans-serif", letterSpacing: "-0.02em", marginBottom: 8 }}>{p.amount}</div>
              <div style={{ color: "rgba(240,236,255,0.35)", fontSize: 11, fontFamily: "monospace" }}>tx: {p.tx}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid rgba(139,92,246,0.08)", padding: "28px 28px", textAlign: "center" }}>
        <span style={{ color: "rgba(240,236,255,0.25)", fontSize: 12 }}>Refract Protocol — Parametric insurance on Stellar/Soroban · Built for DRIPS Wave Hackathon</span>
      </footer>
    </div>
  );
}

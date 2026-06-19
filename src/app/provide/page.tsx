"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

const POOL_DATA = {
  tvl: 18_400_000,
  apy: 8.9,
  sharePrice: 1.0319,
  utilization: 15.76,
  premiums30d: 284_000,
  activePolicies: 247,
  capacityUsed: 2_900_000,
  capacityTotal: 18_400_000,
};

const RISK_BREAKDOWN = [
  { type: "Stablecoin Depeg", allocated: 22, color: "#8b5cf6", pct: 22 },
  { type: "Market Crash", allocated: 18, color: "#f59e0b", pct: 18 },
  { type: "Liquidation Shield", allocated: 35, color: "#10b981", pct: 35 },
  { type: "Smart Contract Risk", allocated: 15, color: "#ef4444", pct: 15 },
  { type: "Flight Delay", allocated: 10, color: "#06b6d4", pct: 10 },
];

export default function ProvidePage() {
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const sharesOut = amount ? (parseFloat(amount) / POOL_DATA.sharePrice).toFixed(4) : "—";
  const usdcOut = amount ? (parseFloat(amount) * POOL_DATA.sharePrice).toFixed(2) : "—";

  // Donut chart for risk breakdown
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const size = 160;
    canvas.width = canvas.height = size * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const cx = size / 2, cy = size / 2, r = 62, innerR = 42;
    let startAngle = -Math.PI / 2;

    RISK_BREAKDOWN.forEach(seg => {
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

  return (
    <div style={{ minHeight: "100vh", background: "var(--pm-bg)" }}>
      {/* Navbar */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 28px", height: 64,
        background: "rgba(7,5,15,0.9)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(139,92,246,0.12)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <div style={{ width: 32, height: 32, background: "linear-gradient(135deg,#8b5cf6,#5b21b6)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 16px rgba(139,92,246,0.4)" }}>
              <span style={{ color: "#fff", fontSize: 16 }}>⬡</span>
            </div>
            <span style={{ color: "#f0ecff", fontWeight: 800, fontSize: 18, fontFamily: "Syne, sans-serif", letterSpacing: "-0.02em" }}>Refract</span>
          </Link>
          <Link href="/cover" style={{ color: "rgba(240,236,255,0.5)", fontSize: 14, textDecoration: "none", fontWeight: 500 }}>Coverage</Link>
          <Link href="/provide" style={{ color: "#8b5cf6", fontSize: 14, textDecoration: "none", fontWeight: 600 }}>Provide Capital</Link>
        </div>
        <button className="pm-btn-primary" style={{ fontSize: 13, padding: "7px 18px" }} onClick={() => setIsConnected(!isConnected)}>
          {isConnected ? "G3x...k9Mf" : "Connect Wallet"}
        </button>
      </nav>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 28px" }}>
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 28, fontWeight: 800, color: "#f0ecff", marginBottom: 8, letterSpacing: "-0.02em" }}>Provide Capital</h1>
          <p style={{ color: "rgba(240,236,255,0.45)", fontSize: 14 }}>Underwrite Refract policies. Earn premiums when no triggers fire. Pool capital backs all coverage categories.</p>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 28 }}>
          {[
            { label: "Pool TVL", value: `$${(POOL_DATA.tvl / 1e6).toFixed(1)}M` },
            { label: "30d APY", value: `${POOL_DATA.apy}%`, color: "#10b981" },
            { label: "Share Price", value: `$${POOL_DATA.sharePrice}` },
            { label: "Utilization", value: `${POOL_DATA.utilization}%` },
          ].map(s => (
            <div key={s.label} className="pm-panel" style={{ padding: "18px 20px" }}>
              <div style={{ color: "rgba(240,236,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{s.label}</div>
              <div style={{ color: s.color || "#f0ecff", fontSize: 22, fontWeight: 800, fontFamily: "Syne, sans-serif", letterSpacing: "-0.02em" }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, alignItems: "start" }}>
          {/* Left: Pool info */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Risk breakdown donut */}
            <div className="pm-panel" style={{ padding: 24 }}>
              <h3 style={{ color: "#f0ecff", fontSize: 16, fontWeight: 700, fontFamily: "Syne, sans-serif", marginBottom: 20, letterSpacing: "-0.01em" }}>Capital Allocation</h3>
              <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 32, alignItems: "center" }}>
                <canvas ref={canvasRef} style={{ width: 160, height: 160 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {RISK_BREAKDOWN.map(seg => (
                    <div key={seg.type} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: seg.color, flexShrink: 0 }} />
                        <span style={{ color: "rgba(240,236,255,0.6)", fontSize: 12 }}>{seg.type}</span>
                      </div>
                      <span style={{ color: "#f0ecff", fontSize: 12, fontWeight: 600 }}>{seg.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* How it works */}
            <div className="pm-panel" style={{ padding: 24 }}>
              <h3 style={{ color: "#f0ecff", fontSize: 16, fontWeight: 700, fontFamily: "Syne, sans-serif", marginBottom: 20, letterSpacing: "-0.01em" }}>How capital provision works</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {[
                  { n: "01", title: "Deposit USDC", desc: "Receive Refract pool shares (PPS) proportional to your deposit." },
                  { n: "02", title: "Underwrite policies", desc: "Your capital backs coverage sold to policy buyers. You collect premiums upfront." },
                  { n: "03", title: "Earn continuously", desc: "Premium yield accrues to your PPS shares, increasing their USDC value over time." },
                  { n: "04", title: "Shared risk", desc: "If a payout fires, it's split proportionally across all capital providers — not concentrated on any one LP." },
                ].map(item => (
                  <div key={item.n} style={{ display: "flex", gap: 16 }}>
                    <div style={{ width: 28, height: 28, background: "rgba(139,92,246,0.15)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#8b5cf6", fontSize: 11, fontWeight: 700 }}>{item.n}</div>
                    <div>
                      <div style={{ color: "#f0ecff", fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{item.title}</div>
                      <div style={{ color: "rgba(240,236,255,0.45)", fontSize: 12, lineHeight: 1.5 }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pool utilization */}
            <div className="pm-panel" style={{ padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ color: "#f0ecff", fontSize: 15, fontWeight: 700, fontFamily: "Syne, sans-serif", margin: 0, letterSpacing: "-0.01em" }}>Pool Capacity</h3>
                <span style={{ color: POOL_DATA.utilization > 70 ? "#f59e0b" : "#10b981", fontSize: 13, fontWeight: 700 }}>{POOL_DATA.utilization}% utilized</span>
              </div>
              <div style={{ height: 8, background: "rgba(255,255,255,0.05)", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
                <div style={{ height: "100%", width: `${(POOL_DATA.utilization / 80) * 100}%`, background: "linear-gradient(90deg,#8b5cf6,#10b981)", borderRadius: 4 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "rgba(240,236,255,0.35)", fontSize: 11 }}>
                <span>${(POOL_DATA.capacityUsed / 1e6).toFixed(1)}M locked in policies</span>
                <span>${(POOL_DATA.capacityTotal / 1e6).toFixed(1)}M total / 80% max</span>
              </div>
            </div>
          </div>

          {/* Right: Deposit form */}
          <div style={{ position: "sticky", top: 80 }}>
            <div className="pm-panel" style={{ padding: 24 }}>
              {/* Tab */}
              <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: 4 }}>
                {(["deposit", "withdraw"] as const).map(t => (
                  <button key={t} onClick={() => setTab(t)} style={{
                    flex: 1, padding: "8px 0", borderRadius: 6, border: "none", cursor: "pointer",
                    background: tab === t ? "rgba(139,92,246,0.15)" : "transparent",
                    color: tab === t ? "#8b5cf6" : "rgba(240,236,255,0.4)",
                    fontSize: 13, fontWeight: 600, textTransform: "capitalize",
                  }}>{t}</button>
                ))}
              </div>

              {/* Share price */}
              <div style={{ background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 8, padding: "10px 14px", marginBottom: 20, display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "rgba(240,236,255,0.5)", fontSize: 12 }}>PPS share price</span>
                <span style={{ color: "#8b5cf6", fontSize: 14, fontWeight: 700 }}>${POOL_DATA.sharePrice}</span>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", color: "rgba(240,236,255,0.5)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  {tab === "deposit" ? "USDC Amount" : "PPS Shares"}
                </label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  className="pm-input"
                  style={{ width: "100%" }}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {["25%", "50%", "75%", "MAX"].map(p => (
                    <button key={p} style={{ flex: 1, padding: "4px 0", background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 4, color: "#8b5cf6", fontSize: 10, cursor: "pointer" }}>{p}</button>
                  ))}
                </div>
              </div>

              {amount && (
                <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "14px 16px", marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ color: "rgba(240,236,255,0.4)", fontSize: 12 }}>{tab === "deposit" ? "PPS shares received" : "USDC received"}</span>
                    <span style={{ color: "#f0ecff", fontSize: 13, fontWeight: 600 }}>{tab === "deposit" ? sharesOut : usdcOut}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "rgba(240,236,255,0.4)", fontSize: 12 }}>Estimated 30d yield</span>
                    <span style={{ color: "#10b981", fontSize: 12, fontWeight: 600 }}>
                      +${((parseFloat(amount || "0") * POOL_DATA.apy) / 100 / 12).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              <button className="pm-btn-primary" style={{ width: "100%", padding: "14px 0", fontSize: 15, fontWeight: 700 }}>
                {!isConnected ? "Connect Wallet" : tab === "deposit" ? "Provide Capital" : "Withdraw USDC"}
              </button>

              <div style={{ marginTop: 14, padding: "12px 14px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 6 }}>
                <p style={{ color: "rgba(245,158,11,0.9)", fontSize: 11, margin: 0, lineHeight: 1.5 }}>
                  ⚠️ Capital providers share in payout risk. If oracle triggers fire, pool capital covers claims proportionally.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

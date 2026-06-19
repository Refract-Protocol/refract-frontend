"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

const COVERAGE_TYPES = [
  { id: 0, icon: "🪙", name: "Stablecoin Depeg", shortName: "Depeg", baseRatePct: 3.0, riskMult: 1.0, riskLevel: "medium", maxCoverage: 100_000, trigger: "USDC < $0.95" },
  { id: 1, icon: "📉", name: "Market Crash", shortName: "Crash", baseRatePct: 4.5, riskMult: 1.5, riskLevel: "high", maxCoverage: 50_000, trigger: "Market -30% in 24h" },
  { id: 2, icon: "🛡️", name: "Liquidation Shield", shortName: "Liquidation", baseRatePct: 6.0, riskMult: 2.0, riskLevel: "high", maxCoverage: 200_000, trigger: "Collateral ratio < 85%" },
  { id: 3, icon: "🔐", name: "Smart Contract Risk", shortName: "SmartContract", baseRatePct: 9.0, riskMult: 3.0, riskLevel: "critical", maxCoverage: 500_000, trigger: "Protocol TVL -50% in 1hr" },
  { id: 4, icon: "✈️", name: "Flight Delay", shortName: "Flight", baseRatePct: 2.4, riskMult: 0.8, riskLevel: "low", maxCoverage: 2_000, trigger: "Delay > 120 minutes" },
];

const RISK_TAG_COLORS: Record<string, string> = {
  low: "#10b981",
  medium: "#8b5cf6",
  high: "#f59e0b",
  critical: "#ef4444",
};

export default function CoverPage() {
  const [selectedType, setSelectedType] = useState(0);
  const [coverageAmount, setCoverageAmount] = useState("5000");
  const [durationDays, setDurationDays] = useState(30);
  const [isConnected, setIsConnected] = useState(false);
  const [step, setStep] = useState<"select" | "configure" | "confirm">("select");

  const ct = COVERAGE_TYPES[selectedType];

  const premium = useMemo(() => {
    const amount = parseFloat(coverageAmount) || 0;
    const annualRate = ct.baseRatePct / 100;
    return amount * annualRate * (durationDays / 365);
  }, [coverageAmount, durationDays, ct]);

  const expiryDate = new Date(Date.now() + durationDays * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

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
          <Link href="/cover" style={{ color: "#8b5cf6", fontSize: 14, textDecoration: "none", fontWeight: 600 }}>Coverage</Link>
          <Link href="/provide" style={{ color: "rgba(240,236,255,0.5)", fontSize: 14, textDecoration: "none", fontWeight: 500 }}>Provide Capital</Link>
        </div>
        <button className="pm-btn-primary" style={{ fontSize: 13, padding: "7px 18px" }} onClick={() => setIsConnected(!isConnected)}>
          {isConnected ? "G3x...k9Mf" : "Connect Wallet"}
        </button>
      </nav>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 28px" }}>
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ fontFamily: "Syne, sans-serif", fontSize: 28, fontWeight: 800, color: "#f0ecff", marginBottom: 8, letterSpacing: "-0.02em" }}>Get Coverage</h1>
          <p style={{ color: "rgba(240,236,255,0.45)", fontSize: 14 }}>Choose your coverage type, set amount and duration. Premium paid once. Payout automatic.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, alignItems: "start" }}>
          {/* Left: Coverage type selector + config */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Coverage type cards */}
            <div>
              <div style={{ color: "rgba(240,236,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>1. Select Coverage Type</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {COVERAGE_TYPES.map(ct => (
                  <button key={ct.id} onClick={() => { setSelectedType(ct.id); setStep("configure"); }} style={{
                    width: "100%", padding: "18px 20px",
                    background: selectedType === ct.id ? "rgba(139,92,246,0.1)" : "rgba(255,255,255,0.025)",
                    border: `1px solid ${selectedType === ct.id ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.06)"}`,
                    borderRadius: 10, cursor: "pointer", textAlign: "left",
                    transition: "all 0.15s",
                    boxShadow: selectedType === ct.id ? "0 0 20px rgba(139,92,246,0.1)" : "none",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: 22 }}>{ct.icon}</span>
                        <div style={{ textAlign: "left" }}>
                          <div style={{ color: "#f0ecff", fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{ct.name}</div>
                          <div style={{ color: "rgba(240,236,255,0.4)", fontSize: 12 }}>{ct.trigger}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ color: RISK_TAG_COLORS[ct.riskLevel], fontSize: 11, fontWeight: 600, textTransform: "uppercase", marginBottom: 2 }}>{ct.riskLevel}</div>
                        <div style={{ color: "#8b5cf6", fontSize: 13, fontWeight: 700 }}>{ct.baseRatePct}%/yr</div>
                      </div>
                    </div>
                    {selectedType === ct.id && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(139,92,246,0.15)", display: "flex", gap: 8 }}>
                        <span className="pm-tag pm-tag-violet">Auto-settle</span>
                        <span className="pm-tag pm-tag-violet">No form required</span>
                        <span className="pm-tag pm-tag-safe">On-chain</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Configuration */}
            <div className="pm-panel" style={{ padding: 24 }}>
              <div style={{ color: "rgba(240,236,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 20 }}>2. Configure Policy</div>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", color: "rgba(240,236,255,0.6)", fontSize: 12, marginBottom: 8 }}>Coverage Amount (USDC)</label>
                <input
                  type="number"
                  value={coverageAmount}
                  onChange={e => setCoverageAmount(e.target.value)}
                  className="pm-input"
                  style={{ width: "100%" }}
                  placeholder="5000"
                  min={100}
                  max={COVERAGE_TYPES[selectedType].maxCoverage}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {["1,000", "5,000", "10,000", "25,000"].map(v => (
                    <button key={v} onClick={() => setCoverageAmount(v.replace(",", ""))} style={{
                      flex: 1, padding: "5px 0", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 4, color: "#8b5cf6", fontSize: 11, cursor: "pointer",
                    }}>${v}</button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <label style={{ color: "rgba(240,236,255,0.6)", fontSize: 12 }}>Coverage Duration</label>
                  <span style={{ color: "#8b5cf6", fontSize: 13, fontWeight: 700 }}>{durationDays} days · Expires {expiryDate}</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={365}
                  value={durationDays}
                  onChange={e => setDurationDays(Number(e.target.value))}
                  className="pm-slider"
                  style={{ width: "100%", "--pct": `${(durationDays / 365) * 100}%` } as React.CSSProperties}
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ color: "rgba(240,236,255,0.3)", fontSize: 10 }}>1 day</span>
                  <span style={{ color: "rgba(240,236,255,0.3)", fontSize: 10 }}>1 year</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Quote panel */}
          <div style={{ position: "sticky", top: 80 }}>
            <div className="pm-panel" style={{ padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
                <span style={{ fontSize: 22 }}>{COVERAGE_TYPES[selectedType].icon}</span>
                <div>
                  <div style={{ color: "#f0ecff", fontSize: 15, fontWeight: 700 }}>{COVERAGE_TYPES[selectedType].name}</div>
                  <div style={{ color: "rgba(240,236,255,0.4)", fontSize: 12 }}>{durationDays}-day policy</div>
                </div>
              </div>

              {/* Risk heat indicator */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ color: "rgba(240,236,255,0.4)", fontSize: 11 }}>Risk level</span>
                  <span style={{ color: RISK_TAG_COLORS[COVERAGE_TYPES[selectedType].riskLevel], fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>{COVERAGE_TYPES[selectedType].riskLevel}</span>
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${({ low: 20, medium: 45, high: 72, critical: 95 } as Record<string, number>)[COVERAGE_TYPES[selectedType].riskLevel]}%`,
                    background: `linear-gradient(90deg,#10b981,${RISK_TAG_COLORS[COVERAGE_TYPES[selectedType].riskLevel]})`,
                    borderRadius: 2,
                  }} />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
                {[
                  { label: "Coverage amount", value: `$${parseFloat(coverageAmount || "0").toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
                  { label: "Annual rate", value: `${COVERAGE_TYPES[selectedType].baseRatePct}%` },
                  { label: "Duration", value: `${durationDays} days` },
                  { label: "Expires", value: expiryDate },
                ].map(item => (
                  <div key={item.label} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "rgba(240,236,255,0.45)", fontSize: 13 }}>{item.label}</span>
                    <span style={{ color: "#f0ecff", fontSize: 13, fontWeight: 500 }}>{item.value}</span>
                  </div>
                ))}
              </div>

              <div style={{ borderTop: "1px solid rgba(139,92,246,0.12)", paddingTop: 16, marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "rgba(240,236,255,0.6)", fontSize: 13 }}>Total premium</span>
                  <span style={{ color: "#8b5cf6", fontSize: 24, fontWeight: 800, fontFamily: "Syne, sans-serif" }}>
                    ${premium.toFixed(2)}
                  </span>
                </div>
                <div style={{ color: "rgba(240,236,255,0.3)", fontSize: 11, textAlign: "right", marginTop: 2 }}>One-time payment · USDC</div>
              </div>

              <button
                className="pm-btn-primary"
                style={{ width: "100%", padding: "14px 0", fontSize: 15, fontWeight: 700 }}
                onClick={() => setStep("confirm")}
              >
                {isConnected ? "Buy Coverage" : "Connect to Continue"}
              </button>

              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                {["🔒 No claims form required", "⚡ Instant payout via oracle", "🌐 Fully on-chain, non-custodial"].map(item => (
                  <div key={item} style={{ color: "rgba(240,236,255,0.35)", fontSize: 11 }}>{item}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

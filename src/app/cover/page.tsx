import { Meter } from "@/components/ui";

// ... existing imports and component body unchanged ...

// Replaces the hand-rolled risk-heat bar (previously lines 386-394).
<Meter
  label="Risk heat"
  value={RISK_HEAT[ct.riskLevel]}
  min={0}
  max={100}
  tone={
    ct.riskLevel === "high"
      ? "danger"
      : ct.riskLevel === "medium"
        ? "warning"
        : "safe"
  }
  valueText={`${RISK_HEAT[ct.riskLevel]}%`}
  showValue
/>

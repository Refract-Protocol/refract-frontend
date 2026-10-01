import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PolicyCertificateModal, type PolicyCertificateData } from "./PolicyCertificate";

describe("PolicyCertificate Component", () => {
  const mockPolicy: PolicyCertificateData = {
    id: "pol-test-12345",
    holder: "GBEXAMPLEADDRESS1234567890",
    coverageType: 1,
    coverageTypeName: "Stablecoin Depeg",
    coverageAmount: "50000000000",
    premium: "150000000",
    durationDays: 30,
    expiresAt: 1735689600,
    createdAt: "2026-01-01T00:00:00Z",
    txHash: "tx-mock-hash-9999",
    demo: false,
  };

  it("renders certificate fields accurately", () => {
    const html = renderToStaticMarkup(
      <PolicyCertificateModal
        policy={mockPolicy}
        isOpen={true}
        onClose={() => {}}
      />
    );

    expect(html).toContain("REFRACT PROTOCOL");
    expect(html).toContain("Stablecoin Depeg");
    expect(html).toContain("pol-test-12345");
    expect(html).toContain("$5,000.00");
    expect(html).toContain("VERIFIED ON-CHAIN");
    expect(html).toContain("Print / Save as PDF");
  });

  it("renders demo simulation label for demo policies", () => {
    const demoPolicy = { ...mockPolicy, demo: true };
    const html = renderToStaticMarkup(
      <PolicyCertificateModal
        policy={demoPolicy}
        isOpen={true}
        onClose={() => {}}
      />
    );

    expect(html).toContain("DEMO SIMULATION");
  });

  it("renders nothing when isOpen is false", () => {
    const html = renderToStaticMarkup(
      <PolicyCertificateModal
        policy={mockPolicy}
        isOpen={false}
        onClose={() => {}}
      />
    );

    expect(html).toBe("");
  });
});

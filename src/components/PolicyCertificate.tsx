"use client";

import { useEffect, useState } from "react";
import { formatUsd, fromStroops } from "@/lib/format";
import { truncateAddress } from "@/lib/wallet/WalletProvider";
import { Button } from "@/components/ui";

export interface PolicyCertificateData {
  id: string;
  holder: string;
  coverageType: number;
  coverageTypeName: string;
  coverageAmount: string | number;
  premium: string | number;
  durationDays: number;
  expiresAt: number;
  createdAt: string;
  txHash?: string;
  demo?: boolean;
}

export interface PolicyCertificateModalProps {
  policy: PolicyCertificateData | null;
  isOpen: boolean;
  onClose: () => void;
}

export function PolicyCertificateModal({
  policy,
  isOpen,
  onClose,
}: PolicyCertificateModalProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !policy) return null;

  const amountNumber =
    typeof policy.coverageAmount === "string" && policy.coverageAmount.length > 8
      ? fromStroops(policy.coverageAmount)
      : Number(policy.coverageAmount);

  const premiumNumber =
    typeof policy.premium === "string" && policy.premium.length > 8
      ? fromStroops(policy.premium)
      : Number(policy.premium);

  const issueDate = new Date(policy.createdAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const expiryDate = new Date(policy.expiresAt * 1000).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cert-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md print:p-0 print:bg-white print:static print:block"
    >
      <div className="relative w-full max-w-2xl rounded-2xl border border-pm-border bg-[#0e0c19] p-8 text-pm-text shadow-2xl print:max-w-none print:border-none print:bg-white print:text-black print:p-8 print:shadow-none">
        {/* Certificate Header */}
        <div className="mb-6 flex items-start justify-between border-b border-white/10 pb-6 print:border-black/20">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl font-bold text-pm-violet print:text-purple-700">⬡</span>
              <span className="font-display text-lg font-black tracking-tight text-white print:text-black">
                REFRACT PROTOCOL
              </span>
            </div>
            <p className="text-xs uppercase tracking-widest text-pm-text/50 print:text-gray-500">
              Parametric Insurance Verification Certificate
            </p>
          </div>
          {policy.demo ? (
            <span className="rounded border border-pm-amber/40 bg-pm-amber/10 px-2.5 py-1 text-xs font-bold text-pm-amber print:border-amber-600 print:text-amber-800">
              DEMO SIMULATION
            </span>
          ) : (
            <span className="rounded border border-pm-green/40 bg-pm-green/10 px-2.5 py-1 text-xs font-bold text-pm-green print:border-green-600 print:text-green-800">
              VERIFIED ON-CHAIN
            </span>
          )}
        </div>

        {/* Certificate Body */}
        <div className="space-y-6">
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 print:border-gray-200 print:bg-gray-50">
            <h2 id="cert-title" className="text-xl font-extrabold text-white print:text-black mb-1">
              {policy.coverageTypeName}
            </h2>
            <div className="font-mono text-xs text-pm-text/50 print:text-gray-600">
              Policy ID: {policy.id}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-white/5 p-4 print:border-gray-200">
              <div className="text-[11px] uppercase tracking-wider text-pm-text/40 print:text-gray-500">
                Coverage Amount
              </div>
              <div className="mt-1 text-xl font-black text-pm-violet print:text-purple-800">
                {formatUsd(amountNumber)}
              </div>
            </div>

            <div className="rounded-lg border border-white/5 p-4 print:border-gray-200">
              <div className="text-[11px] uppercase tracking-wider text-pm-text/40 print:text-gray-500">
                Premium Paid
              </div>
              <div className="mt-1 text-xl font-bold text-pm-text print:text-black">
                {formatUsd(premiumNumber)}
              </div>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs border-t border-b border-white/10 py-4 print:border-gray-200">
            <div>
              <dt className="text-pm-text/45 print:text-gray-500">Policy Holder</dt>
              <dd className="mt-0.5 font-mono font-medium text-pm-text print:text-black">
                {truncateAddress(policy.holder)}
              </dd>
            </div>
            <div>
              <dt className="text-pm-text/45 print:text-gray-500">Term Duration</dt>
              <dd className="mt-0.5 font-medium text-pm-text print:text-black">
                {policy.durationDays} Days
              </dd>
            </div>
            <div>
              <dt className="text-pm-text/45 print:text-gray-500">Issue Date</dt>
              <dd className="mt-0.5 font-medium text-pm-text print:text-black">{issueDate}</dd>
            </div>
            <div>
              <dt className="text-pm-text/45 print:text-gray-500">Expiration Date</dt>
              <dd className="mt-0.5 font-medium text-pm-text print:text-black">{expiryDate}</dd>
            </div>
            {policy.txHash && (
              <div className="col-span-2">
                <dt className="text-pm-text/45 print:text-gray-500">Settlement Transaction Reference</dt>
                <dd className="mt-0.5 font-mono text-[11px] text-pm-violet print:text-purple-800 break-all">
                  {policy.txHash}
                </dd>
              </div>
            )}
          </dl>

          <p className="text-[11px] leading-relaxed text-pm-text/40 print:text-gray-500 italic">
            This certificate verifies non-custodial parametric coverage issued on Stellar Soroban smart contracts. Payouts execute automatically upon decentralized oracle trigger verification without manual claims submission.
          </p>
        </div>

        {/* Modal Actions (hidden during print) */}
        <div className="mt-8 flex items-center justify-end gap-3 print:hidden">
          <Button variant="outline" type="button" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" type="button" onClick={handlePrint}>
            🖨️ Print / Save as PDF
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui";

export interface SummaryLine {
  label: string;
  value: string;
}

interface PreSignConfirmModalProps {
  open: boolean;
  title: string;
  lines: SummaryLine[];
  /** Highlighted final line, e.g. total premium or deposit amount. */
  total?: SummaryLine;
  hardwareWallet?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * App-branded checkpoint shown right before handing off to Freighter's own
 * sign prompt. Summarizes the transaction from the form's already-known
 * state (not by decoding XDR). Cancel just closes it — the caller keeps its
 * form values untouched.
 */
export function PreSignConfirmModal({
  open,
  title,
  lines,
  total,
  hardwareWallet,
  onConfirm,
  onCancel,
}: PreSignConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="presign-title"
        className="pm-panel w-full max-w-[400px] p-6 animate-fade-up"
      >
        <h2 id="presign-title" className="mb-1 font-display text-lg font-bold text-pm-text">
          {title}
        </h2>
        <p className="mb-5 text-xs text-pm-text/45">
          Review the details below. Your wallet will ask you to sign next.
        </p>
        <dl className="flex flex-col gap-2.5">
          {lines.map((l) => (
            <div key={l.label} className="flex justify-between gap-4">
              <dt className="text-[13px] text-pm-text/45">{l.label}</dt>
              <dd className="text-right text-[13px] font-medium text-pm-text">{l.value}</dd>
            </div>
          ))}
        </dl>
        {total && (
          <div className="mt-4 flex items-center justify-between border-t border-pm-border pt-4">
            <span className="text-[13px] text-pm-text/60">{total.label}</span>
            <span className="font-display text-xl font-extrabold text-pm-violet">{total.value}</span>
          </div>
        )}
        {hardwareWallet && (
          <p className="mt-4 rounded-md border border-pm-amber/20 bg-pm-amber/[0.06] px-3 py-2 text-[11px] text-pm-amber">
            You&apos;ll need to confirm on your Ledger device — keep it unlocked with the Stellar app open.
          </p>
        )}
        <div className="mt-6 flex gap-3">
          <Button type="button" variant="outline" block onClick={onCancel}>
            Cancel
          </Button>
          <Button ref={confirmRef} type="button" variant="primary" block onClick={onConfirm}>
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}

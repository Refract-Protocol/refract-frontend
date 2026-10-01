import React from "react";
import { Card } from "./Card";
import { Button } from "./Button";

interface TransactionStatusProps {
  status: "idle" | "submitting" | "signing" | "pending-confirmation" | "success" | "error";
  title?: string;
  demo?: boolean;
  demoMessage?: string;
  errorMessage?: string;
  onReset?: () => void;
  resetLabel?: string;
  children?: React.ReactNode;
}

/**
 * Unified visual tracker for transaction states (pending confirmation, success shell, demo notice).
 */
export function TransactionStatus({
  status,
  title = "Transaction completed",
  demo = false,
  demoMessage = "Demo mode: the Refract API was not reachable, so this action was simulated client-side.",
  errorMessage,
  onReset,
  resetLabel = "Make another transaction",
  children,
}: TransactionStatusProps) {
  if (status === "pending-confirmation") {
    return (
      <Card padding="md" role="status" aria-live="polite" className="border-pm-violet/30 bg-pm-violet/[0.04]">
        <div className="mb-4 flex items-center gap-2.5 text-pm-violet">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-pm-violet border-t-transparent" aria-hidden="true" />
          <span className="font-display text-base font-bold">{title} (confirming…)</span>
        </div>
        <p className="mb-4 rounded-md border border-pm-violet/20 bg-pm-violet/[0.06] px-3 py-2 text-[11px] leading-relaxed text-pm-violet">
          Signed transaction submitted to Soroban RPC. Confirming on-chain block inclusion…
        </p>
        {children}
      </Card>
    );
  }

  if (status === "success") {
    return (
      <Card padding="md" role="status" aria-live="polite">
        <div className="mb-4 flex items-center gap-2.5 text-pm-green">
          <span className="text-xl" aria-hidden="true">✓</span>
          <span className="font-display text-base font-bold">{title}</span>
        </div>
        {demo && (
          <p className="mb-4 rounded-md border border-pm-amber/20 bg-pm-amber/[0.06] px-3 py-2 text-[11px] leading-relaxed text-pm-amber">
            {demoMessage}
          </p>
        )}
        {children}
        {onReset && (
          <Button type="button" variant="outline" block className="mt-5" onClick={onReset}>
            {resetLabel}
          </Button>
        )}
      </Card>
    );
  }

  if (status === "error" && errorMessage) {
    return (
      <p role="alert" className="mt-3 text-[12px] text-pm-red">
        {errorMessage}
      </p>
    );
  }

  return null;
}

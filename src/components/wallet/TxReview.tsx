"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { decodeTransactionSummary, hasAmountMismatch, type TransactionSummary } from "@/lib/wallet/decodeTransaction";
import { truncateAddress } from "@/lib/wallet/WalletProvider";
import { fromStroops } from "@/lib/format";

export interface TxReviewRequest {
  txXdr: string;
  networkPassphrase: string;
  /** Human label for the action, e.g. "Buy coverage". */
  action: string;
  /** The user's originally-entered form values, shown alongside the decoded summary. */
  entered: { label: string; value: string }[];
  /** The amount the user entered, in base units, cross-checked against the XDR. */
  expectedStroops: string;
}

interface PendingReview extends TxReviewRequest {
  summary: TransactionSummary | null;
  resolve: (approved: boolean) => void;
}

/**
 * Pre-sign confirmation step: `requestReview` decodes the unsigned envelope,
 * shows it next to what the user typed (warning on a mismatch), and resolves
 * true only if the user chooses to continue to their wallet's sign prompt.
 * Render `reviewDialog` somewhere in the page.
 */
export function useTxReview() {
  const [pending, setPending] = useState<PendingReview | null>(null);

  const requestReview = useCallback(
    (req: TxReviewRequest) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...req, summary: decodeTransactionSummary(req.txXdr, req.networkPassphrase), resolve });
      }),
    []
  );

  const finish = useCallback(
    (approved: boolean) => {
      pending?.resolve(approved);
      setPending(null);
    },
    [pending]
  );

  const reviewDialog = pending ? <TxReviewDialog review={pending} onFinish={finish} /> : null;
  return { requestReview, reviewDialog };
}

function TxReviewDialog({ review, onFinish }: { review: PendingReview; onFinish: (approved: boolean) => void }) {
  const { summary } = review;
  const mismatch = summary ? hasAmountMismatch(summary, review.expectedStroops) : false;
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onFinish(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onFinish]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-review-title"
        className="w-full max-w-[440px] rounded-xl border border-pm-border bg-pm-bg p-5 shadow-2xl"
      >
        <h2 id="tx-review-title" className="mb-4 font-display text-base font-bold text-pm-text">
          Review transaction: {review.action}
        </h2>

        <h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-pm-text/40">You entered</h3>
        <dl className="mb-4 flex flex-col gap-1.5 text-[13px]">
          {review.entered.map((row) => (
            <div key={row.label} className="flex justify-between gap-3">
              <dt className="text-pm-text/45">{row.label}</dt>
              <dd className="text-pm-text">{row.value}</dd>
            </div>
          ))}
        </dl>

        <h3 className="mb-1.5 text-[11px] uppercase tracking-wide text-pm-text/40">Transaction contents</h3>
        {summary ? (
          <dl className="mb-4 flex flex-col gap-1.5 text-[13px]">
            {summary.operations.map((op, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-pm-text/45">Action</dt>
                  <dd className="font-mono text-pm-text">{op.functionName ?? op.type}</dd>
                </div>
                {(op.contractId || op.destination) && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-pm-text/45">{op.contractId ? "Contract" : "Destination"}</dt>
                    <dd className="font-mono text-pm-text">{truncateAddress((op.contractId ?? op.destination) as string)}</dd>
                  </div>
                )}
                {op.amounts.map((amount, j) => (
                  <div key={j} className="flex justify-between gap-3">
                    <dt className="text-pm-text/45">Amount</dt>
                    <dd className="font-mono text-pm-text">{fromStroops(amount.toString()).toLocaleString("en-US")}</dd>
                  </div>
                ))}
              </div>
            ))}
            <div className="flex justify-between gap-3">
              <dt className="text-pm-text/45">Max network fee</dt>
              <dd className="font-mono text-pm-text">{fromStroops(summary.feeStroops.toString())} XLM</dd>
            </div>
          </dl>
        ) : (
          <p className="mb-4 rounded-md border border-pm-border px-3 py-2 text-xs text-pm-text/55">
            This transaction couldn&apos;t be fully decoded here. Review its details carefully in your wallet before signing.
          </p>
        )}

        {mismatch && (
          <p role="alert" className="mb-4 rounded-md border border-pm-red/30 bg-pm-red/[0.06] px-3 py-2 text-xs text-pm-red">
            Warning: the amount in this transaction doesn&apos;t match what you entered. Don&apos;t sign unless you&apos;re sure.
          </p>
        )}

        <div className="flex gap-2.5">
          <Button type="button" variant="ghost" block onClick={() => onFinish(false)}>
            Cancel
          </Button>
          <Button ref={confirmRef} type="button" variant="primary" block onClick={() => onFinish(true)}>
            Continue to wallet
          </Button>
        </div>
      </div>
    </div>
  );
}

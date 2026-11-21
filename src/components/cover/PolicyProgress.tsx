"use client";

import type { PendingPolicy, PendingPolicyStatus } from "@/lib/realtime/pendingPolicies";
import type { DroppedPolicy } from "@/lib/cover/batchCheckout";
import { useServerRelativeTime } from "@/hooks/useServerRelativeTime";

const STEPS: { status: PendingPolicyStatus; label: string }[] = [
  { status: "submitted", label: "Submitted" },
  { status: "accepted", label: "Accepted" },
  { status: "active", label: "Active" },
];

const STEP_INDEX: Record<PendingPolicyStatus, number> = {
  submitted: 0,
  accepted: 1,
  active: 2,
  failed: -1,
  cancelled: -1,
};

const REASON_LABEL: Record<string, string> = {
  holder_requested: "cancelled by the holder",
  pool_insufficient: "pool liquidity was insufficient",
  expired: "the policy expired",
  oracle_triggered: "the oracle trigger fired",
};

function describe(entry: PendingPolicy): string {
  switch (entry.status) {
    case "submitted":
      return "Transaction submitted — waiting for the network to pick it up.";
    case "accepted":
      return "Accepted by the network — waiting for the policy to be issued.";
    case "active":
      return entry.confirmedBy === "rest"
        ? "Active. Your transaction went through; live confirmation didn't arrive in time, so this is based on the transaction receipt."
        : "Active and confirmed on-chain.";
    case "failed":
      return `The purchase failed${entry.reason ? `: ${entry.reason}` : ""}. You have not been charged for coverage.`;
    case "cancelled":
      return `Policy cancelled${entry.reason ? ` — ${REASON_LABEL[entry.reason] ?? entry.reason.replace(/_/g, " ")}` : ""}.`;
  }
}

/** Submitted → accepted → active progression for one purchase, driven by `policy.<address>` events. */
export function PolicyProgress({
  entry,
  dropped = [],
}: {
  entry: PendingPolicy;
  dropped?: DroppedPolicy[];
}) {
  const updated = useServerRelativeTime(entry.lastEventTs);
  const current = STEP_INDEX[entry.status];
  const failed = entry.status === "failed" || entry.status === "cancelled";

  return (
    <div data-testid="policy-progress" data-status={entry.status}>
      {!failed && (
        <ol className="mb-3 flex items-center gap-2" aria-label="Purchase progress">
          {STEPS.map((step, i) => {
            const done = i <= current;
            return (
              <li
                key={step.status}
                aria-current={i === current ? "step" : undefined}
                className={`flex flex-1 items-center gap-1.5 text-[11px] font-semibold ${
                  done ? "text-pm-green" : "text-pm-text/35"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${done ? "bg-pm-green" : "bg-pm-text/20"} ${
                    i === current && entry.status !== "active" ? "animate-pulse" : ""
                  }`}
                />
                {step.label}
              </li>
            );
          })}
        </ol>
      )}
      <p
        className={`text-[12px] leading-relaxed ${failed ? "text-pm-red" : "text-pm-text/60"}`}
        role="status"
      >
        {describe(entry)}
        {updated && <span className="text-pm-text/35"> · updated {updated}</span>}
      </p>
      {dropped.length > 0 && (
        <div
          role="alert"
          data-testid="batch-dropped-warning"
          className="mt-3 rounded-md border border-pm-amber/40 bg-pm-amber/10 p-2.5 text-[12px] leading-relaxed text-pm-amber"
        >
          <p className="font-semibold">
            {dropped.length} {dropped.length === 1 ? "policy was" : "policies were"} not included — your wallet balance doesn't cover the full batch.
          </p>
          <ul className="mt-1 list-disc pl-4">
            {dropped.map(({ policy }) => (
              <li key={policy.id}>{policy.label ?? policy.id}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

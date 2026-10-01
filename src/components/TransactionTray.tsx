"use client";

import { useState } from "react";
import { useTransactionStore, type TransactionEntry } from "@/lib/store/useTransactionStore";
import { formatUsd } from "@/lib/format";
import { stellarExpertTxUrl } from "@/lib/stellar";
import { truncateAddress } from "@/lib/wallet/WalletProvider";

const VISIBLE = 5;

const TYPE_LABEL: Record<TransactionEntry["type"], string> = {
  buy: "Buy cover",
  provide: "Provide",
  withdraw: "Withdraw",
};

const STATUS_CLASS: Record<TransactionEntry["status"], string> = {
  pending: "text-pm-text/50",
  signing: "text-pm-violet",
  confirmed: "text-pm-green",
  failed: "text-pm-red",
};

/** Corner widget listing this session's most recent transactions across every page. */
export function TransactionTray() {
  const transactions = useTransactionStore((s) => s.transactions);
  const [open, setOpen] = useState(false);

  if (transactions.length === 0) return null;
  const inFlight = transactions.filter((t) => t.status === "pending" || t.status === "signing").length;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(320px,calc(100vw-2rem))]">
      {open && (
        <ul
          id="transaction-tray"
          className="mb-2 flex flex-col gap-2 rounded-lg border border-pm-border bg-pm-bg/95 p-3 shadow-lg"
        >
          {transactions.slice(0, VISIBLE).map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 text-xs">
              <div>
                <div className="font-semibold text-pm-text">
                  {TYPE_LABEL[t.type]} · {formatUsd(t.amount)}
                </div>
                <div className="text-[11px] text-pm-text/40">
                  {new Date(t.timestamp).toLocaleTimeString()}
                  {t.txHash && (
                    <>
                      {" · "}
                      <a
                        href={stellarExpertTxUrl(t.txHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono underline"
                      >
                        {truncateAddress(t.txHash)}
                      </a>
                    </>
                  )}
                  {t.demo && " · demo"}
                </div>
              </div>
              <span className={`shrink-0 capitalize ${STATUS_CLASS[t.status]}`} title={t.error}>
                {t.status}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="transaction-tray"
        className="ml-auto block rounded-full border border-pm-violet/30 bg-pm-bg/95 px-4 py-2 text-xs font-semibold text-pm-violet shadow-lg"
      >
        Recent transactions ({transactions.length}){inFlight > 0 && ` · ${inFlight} in progress`}
      </button>
    </div>
  );
}

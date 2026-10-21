"use client";
import Link from "next/link";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useAccountBalance } from "@/hooks/useAccountBalance";
import { truncateAddress } from "@/lib/wallet/WalletProvider";
import { ACTIVE_NETWORK } from "@/lib/network";

export function Navbar({ right }: { right?: React.ReactNode }) {
  const wallet = useWallet();
  const account = useAccountBalance(wallet.status === "connected" ? wallet.address : null);
  const usdc = account.balances.find((balance) => balance.asset === "USDC" || balance.asset.startsWith("USDC:"));
  return (
    <header className="sticky top-0 z-40 border-b border-pm-border/60 bg-pm-bg/90 backdrop-blur">
      <nav aria-label="Main navigation" className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-7">
        <Link href="/" className="font-display text-lg font-extrabold text-pm-text">Refract</Link>
        <div className="flex items-center gap-4 text-sm text-pm-text/65">
          <Link href="/cover">Cover</Link><Link href="/provide">Provide</Link><Link href="/dashboard">Dashboard</Link>
          <span className="hidden rounded-full border border-pm-border px-2 py-1 text-[10px] sm:inline">{ACTIVE_NETWORK.badge}</span>
          {wallet.status === "connected" && <span className="hidden text-xs sm:inline" aria-label="Live wallet balance">{usdc ? `${Number(usdc.balance).toFixed(2)} USDC` : truncateAddress(wallet.address ?? "")}{account.isStale ? " · saved" : ""}</span>}
          {right}
        </div>
      </nav>
    </header>
  );
}

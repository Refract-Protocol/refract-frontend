"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet, truncateAddress } from "@/lib/wallet/WalletProvider";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { notify } from "@/lib/store/notificationStore";

/**
 * Freighter connect/disconnect control. Client-side only, no secrets —
 * signs nothing itself, just surfaces the connected public key so pages
 * (cover, provide) can attach it to the transactions they build.
 */
export function WalletButton({ size = "sm" }: { size?: "sm" | "md" | "lg" }) {
  const {
    status,
    address,
    network,
    ready,
    installed,
    error,
    connect,
    disconnect,
    hardwareWallet,
    setHardwareWallet,
    availableWallets,
    adapterId,
  } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  if (!ready) {
    return (
      <div className="pm-skeleton h-9 w-[132px]" role="status" aria-label="Checking wallet status" />
    );
  }

  if (!installed) {
    return (
      <a
        href="https://www.freighter.app/"
        target="_blank"
        rel="noreferrer"
        className="pm-btn pm-btn-outline pm-btn-sm"
        title="Install the Freighter wallet extension"
      >
        Install Freighter
      </a>
    );
  }

  if (status === "connected" && address) {
    return (
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={`Wallet menu for ${truncateAddress(address)}`}
          className="pm-btn pm-btn-outline pm-btn-sm font-mono"
        >
          <span className="h-[6px] w-[6px] rounded-full bg-pm-green" aria-hidden="true" />
          {truncateAddress(address)}
        </button>

        {menuOpen && (
          <div
            role="menu"
            aria-label="Wallet actions"
            className="pm-panel absolute right-0 top-[calc(100%+8px)] z-50 w-60 p-2 animate-fade-up"
          >
            <div className="border-b border-pm-border px-2.5 pb-2.5 pt-1">
              <div className="font-mono text-[11px] text-pm-text/50">{address}</div>
              {network && (
                <div className="mt-1 text-[10px] uppercase tracking-wide text-pm-muted">
                  {network}
                  {adapterId && ` · ${availableWallets.find((w) => w.id === adapterId)?.name ?? adapterId}`}
                </div>
              )}
            </div>
            <button
              role="menuitem"
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(address);
                notify({
                  tone: "success",
                  title: "Address copied",
                  dedupeKey: "wallet:copy-address",
                });
              }}
              className="mt-2 flex w-full items-center rounded-md px-2.5 py-2 text-left text-[13px] text-pm-text/80 hover:bg-white/5"
            >
              Copy address
            </button>
            <button
              role="menuitemcheckbox"
              type="button"
              aria-checked={hardwareWallet}
              onClick={() => setHardwareWallet(!hardwareWallet)}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[13px] text-pm-text/80 hover:bg-white/5"
              title="Enable if Freighter signs with a Ledger hardware wallet"
            >
              <span>Using a Ledger</span>
              <span aria-hidden="true">{hardwareWallet ? "✓" : ""}</span>
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                disconnect();
                setMenuOpen(false);
              }}
              className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-[13px] text-pm-red hover:bg-pm-red/10"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  const multiWallet = availableWallets.length > 1;

  return (
    <div className="relative flex flex-col items-end gap-1.5" ref={menuRef}>
      <Button
        type="button"
        size={size}
        variant="primary"
        onClick={() => (multiWallet ? setMenuOpen((v) => !v) : void connect())}
        loading={status === "connecting"}
        aria-haspopup={multiWallet ? "menu" : undefined}
        aria-expanded={multiWallet ? menuOpen : undefined}
      >
        {status === "connecting" ? "Connecting…" : "Connect Wallet"}
      </Button>
      {multiWallet && menuOpen && (
        <div
          role="menu"
          aria-label="Choose a wallet"
          className="pm-panel absolute right-0 top-[calc(100%+8px)] z-50 w-52 p-2 animate-fade-up"
        >
          {availableWallets.map((wallet) => (
            <button
              key={wallet.id}
              role="menuitem"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void connect(wallet.id);
              }}
              className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-[13px] text-pm-text/80 hover:bg-white/5"
            >
              {wallet.name}
            </button>
          ))}
        </div>
      )}
      {status === "error" && error && (
        <span role="alert" className={cn("max-w-[180px] text-right text-[11px] text-pm-red")}>
          {error}
        </span>
      )}
    </div>
  );
}

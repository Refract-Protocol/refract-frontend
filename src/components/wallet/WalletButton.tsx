"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet, truncateAddress } from "@/lib/wallet/WalletProvider";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Freighter connect/disconnect control. Client-side only, no secrets —
 * signs nothing itself, just surfaces the connected public key so pages
 * (cover, provide) can attach it to the transactions they build.
 */
export function WalletButton({ size = "sm" }: { size?: "sm" | "md" | "lg" }) {
  const { status, address, network, ready, installed, error, connect, disconnect } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
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
          className="pm-btn pm-btn-outline pm-btn-sm font-mono"
        >
          <span className="h-[6px] w-[6px] rounded-full bg-pm-green" aria-hidden="true" />
          {truncateAddress(address)}
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="pm-panel absolute right-0 top-[calc(100%+8px)] z-50 w-60 p-2 animate-fade-up"
          >
            <div className="border-b border-pm-border px-2.5 pb-2.5 pt-1">
              <div className="font-mono text-[11px] text-pm-text/50">{address}</div>
              {network && <div className="mt-1 text-[10px] uppercase tracking-wide text-pm-muted">{network}</div>}
            </div>
            <button
              role="menuitem"
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="mt-2 flex w-full items-center rounded-md px-2.5 py-2 text-left text-[13px] text-pm-text/80 hover:bg-white/5"
            >
              {copied ? "Copied ✓" : "Copy address"}
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

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        type="button"
        size={size}
        variant="primary"
        onClick={() => void connect()}
        loading={status === "connecting"}
      >
        {status === "connecting" ? "Connecting…" : "Connect Wallet"}
      </Button>
      {status === "error" && error && (
        <span role="alert" className={cn("max-w-[180px] text-right text-[11px] text-pm-red")}>
          {error}
        </span>
      )}
    </div>
  );
}

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  getAddress,
  getNetwork,
  isConnected as freighterIsConnected,
  isAllowed as freighterIsAllowed,
  requestAccess,
} from "@stellar/freighter-api";

export type WalletStatus = "idle" | "connecting" | "connected" | "error";

interface WalletState {
  status: WalletStatus;
  address: string | null;
  network: string | null;
  /** True once we've finished the initial "was this dApp already authorized?" check. */
  ready: boolean;
  /** Freighter browser extension not detected at all (vs. detected-but-locked/denied). */
  installed: boolean;
  error: string | null;
}

interface WalletContextValue extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const STORAGE_KEY = "refract:wallet-connected";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>({
    status: "idle",
    address: null,
    network: null,
    ready: false,
    installed: false,
    error: null,
  });

  // On mount: silently rehydrate a previously-granted connection (no popup) —
  // only if the browser has the extension and this dApp was already allowed.
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const installed = typeof window !== "undefined" && Boolean(window.freighterApi);
      if (!installed) {
        if (!cancelled) setState((s) => ({ ...s, ready: true, installed: false }));
        return;
      }

      try {
        const wasConnectedHere = localStorage.getItem(STORAGE_KEY) === "1";
        const { isConnected } = await freighterIsConnected();
        if (!isConnected || !wasConnectedHere) {
          if (!cancelled) setState((s) => ({ ...s, ready: true, installed: true }));
          return;
        }

        const { isAllowed } = await freighterIsAllowed();
        if (!isAllowed) {
          if (!cancelled) setState((s) => ({ ...s, ready: true, installed: true }));
          return;
        }

        const [{ address, error: addrErr }, { network }] = await Promise.all([getAddress(), getNetwork()]);
        if (cancelled) return;
        if (addrErr || !address) {
          setState((s) => ({ ...s, ready: true, installed: true }));
          return;
        }
        setState({ status: "connected", address, network, ready: true, installed: true, error: null });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, ready: true, installed: true }));
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    const installed = typeof window !== "undefined" && Boolean(window.freighterApi);
    if (!installed) {
      setState((s) => ({ ...s, status: "error", installed: false, error: "Freighter extension not detected" }));
      return;
    }

    setState((s) => ({ ...s, status: "connecting", error: null }));
    try {
      const { address, error } = await requestAccess();
      if (error || !address) {
        setState((s) => ({ ...s, status: "error", error: error?.message ?? "Connection was declined" }));
        return;
      }
      const { network } = await getNetwork();
      localStorage.setItem(STORAGE_KEY, "1");
      setState({ status: "connected", address, network, ready: true, installed: true, error: null });
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : "Failed to connect wallet",
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    // Freighter has no dApp-initiated "revoke" call — disconnecting here just
    // forgets the local session. Re-connecting will re-prompt the extension.
    localStorage.removeItem(STORAGE_KEY);
    setState((s) => ({ ...s, status: "idle", address: null, network: null, error: null }));
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({ ...state, connect, disconnect }),
    [state, connect, disconnect]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}

/** Formats a Stellar public key as `G3XK…9MF3` for compact display. */
export function truncateAddress(address: string, lead = 4, trail = 4): string {
  if (address.length <= lead + trail) return address;
  return `${address.slice(0, lead)}…${address.slice(-trail)}`;
}

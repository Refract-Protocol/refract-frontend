"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  getAddress,
  getNetwork,
  isConnected as freighterIsConnected,
  isAllowed as freighterIsAllowed,
  requestAccess,
} from "@stellar/freighter-api";

import { deriveAvailability, type WalletAvailability } from "./availability";

/**
 * Pre-connection states come from Freighter detection (see availability.ts);
 * "checking" only lasts until the initial hydrate() probe finishes.
 */
export type WalletStatus = "checking" | WalletAvailability | "connecting" | "connected" | "error";

export interface ConnectedWallet {
  address: string;
  networkPassphrase: string;
}

interface WalletState {
  status: WalletStatus;
  /** Last detected Freighter availability — survives connect errors and disconnects. */
  availability: WalletAvailability | null;
  address: string | null;
  network: string | null;
  /** Needed to sign transactions via Freighter and to submit them to the matching Soroban RPC. */
  networkPassphrase: string | null;
  /** True once we've finished the initial "was this dApp already authorized?" check. */
  ready: boolean;
  /** Freighter browser extension not detected at all (vs. detected-but-locked/denied). */
  installed: boolean;
  error: string | null;
}

interface WalletContextValue extends WalletState {
  /** Resolves to the connected account, or null if the user declined or connecting failed. */
  connect: () => Promise<ConnectedWallet | null>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const STORAGE_KEY = "refract:wallet-connected";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>({
    status: "checking",
    availability: null,
    address: null,
    network: null,
    networkPassphrase: null,
    ready: false,
    installed: false,
    error: null,
  });

  // On mount: silently rehydrate a previously-granted connection (no popup) —
  // only if the browser has the extension and this dApp was already allowed.
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const settle = (availability: WalletAvailability) => {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            status: availability,
            availability,
            ready: true,
            installed: availability !== "not-installed",
          }));
        }
      };

      if (typeof window === "undefined" || !window.freighterApi) {
        settle("not-installed");
        return;
      }

      try {
        const { isConnected } = await freighterIsConnected();
        if (!isConnected) {
          settle("not-installed");
          return;
        }

        const { isAllowed } = await freighterIsAllowed();
        if (!isAllowed) {
          settle("installed-not-allowed");
          return;
        }

        // Allowed dApps get the address back without a popup — unless locked.
        const [{ address, error: addrErr }, { network, networkPassphrase }] = await Promise.all([
          getAddress(),
          getNetwork(),
        ]);
        if (cancelled) return;
        const availability = deriveAvailability({ installed: true, allowed: true, address: addrErr ? null : address });
        const wasConnectedHere = localStorage.getItem(STORAGE_KEY) === "1";
        if (availability !== "ready" || !wasConnectedHere) {
          settle(availability);
          return;
        }
        setState({
          status: "connected",
          availability,
          address,
          network,
          networkPassphrase,
          ready: true,
          installed: true,
          error: null,
        });
      } catch {
        // Extension present but the probe failed — treat like a fresh, unauthorized install.
        settle("installed-not-allowed");
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async (): Promise<ConnectedWallet | null> => {
    const installed = typeof window !== "undefined" && Boolean(window.freighterApi);
    if (!installed) {
      setState((s) => ({
        ...s,
        status: "error",
        availability: "not-installed",
        installed: false,
        error: "Freighter extension not detected",
      }));
      return null;
    }

    setState((s) => ({ ...s, status: "connecting", error: null }));
    try {
      const { address, error } = await requestAccess();
      if (error || !address) {
        setState((s) => ({ ...s, status: "error", error: error?.message ?? "Connection was declined" }));
        return null;
      }
      const { network, networkPassphrase } = await getNetwork();
      localStorage.setItem(STORAGE_KEY, "1");
      setState({
        status: "connected",
        availability: "ready",
        address,
        network,
        networkPassphrase,
        ready: true,
        installed: true,
        error: null,
      });
      return { address, networkPassphrase };
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : "Failed to connect wallet",
      }));
      return null;
    }
  }, []);

  const disconnect = useCallback(() => {
    // Freighter has no dApp-initiated "revoke" call — disconnecting here just
    // forgets the local session. Re-connecting will re-prompt the extension.
    localStorage.removeItem(STORAGE_KEY);
    setState((s) => ({ ...s, status: "ready", availability: "ready", address: null, network: null, networkPassphrase: null, error: null }));
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

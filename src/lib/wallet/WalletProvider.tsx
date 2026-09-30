"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  /** Needed to sign transactions via Freighter and to submit them to the matching Soroban RPC. */
  networkPassphrase: string | null;
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

/**
 * Freighter exposes no push event for account/network switches, so while
 * connected we poll `getAddress()`/`getNetwork()` on this interval (and
 * immediately on window focus), pausing while the tab is hidden.
 */
const WALLET_POLL_MS = 4000;
const NOTICE_MS = 5000;

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>({
    status: "idle",
    address: null,
    network: null,
    networkPassphrase: null,
    ready: false,
    installed: false,
    error: null,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

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

        const [{ address, error: addrErr }, { network, networkPassphrase }] = await Promise.all([
          getAddress(),
          getNetwork(),
        ]);
        if (cancelled) return;
        if (addrErr || !address) {
          setState((s) => ({ ...s, ready: true, installed: true }));
          return;
        }
        setState({
          status: "connected",
          address,
          network,
          networkPassphrase,
          ready: true,
          installed: true,
          error: null,
        });
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
      const { network, networkPassphrase } = await getNetwork();
      localStorage.setItem(STORAGE_KEY, "1");
      setState({
        status: "connected",
        address,
        network,
        networkPassphrase,
        ready: true,
        installed: true,
        error: null,
      });
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
    setState((s) => ({ ...s, status: "idle", address: null, network: null, networkPassphrase: null, error: null }));
  }, []);

  // Live account/network change detection while connected (see WALLET_POLL_MS).
  useEffect(() => {
    if (state.status !== "connected") return;
    let cancelled = false;
    let inFlight = false;

    async function check() {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const { isAllowed } = await freighterIsAllowed();
        const [{ address, error: addrErr }, { network, networkPassphrase, error: netErr }] = await Promise.all([
          getAddress(),
          getNetwork(),
        ]);
        if (cancelled) return;
        if (!isAllowed || addrErr || !address) {
          // Access revoked (or wallet locked) in the extension — fall back to
          // the same local-only disconnected state as `disconnect()`.
          localStorage.removeItem(STORAGE_KEY);
          setState((s) => ({ ...s, status: "idle", address: null, network: null, networkPassphrase: null, error: null }));
          setNotice("Wallet disconnected in Freighter");
          return;
        }
        if (netErr) return;
        const current = stateRef.current;
        const addressChanged = address !== current.address;
        const networkChanged = network !== current.network || networkPassphrase !== current.networkPassphrase;
        if (!addressChanged && !networkChanged) return;
        setState((s) => ({ ...s, address, network, networkPassphrase }));
        setNotice(
          addressChanged && networkChanged
            ? `Wallet switched to ${truncateAddress(address)} on ${network}`
            : addressChanged
              ? `Wallet account switched to ${truncateAddress(address)}`
              : `Wallet network switched to ${network}`
        );
      } catch {
        // Transient extension error — try again on the next tick.
      } finally {
        inFlight = false;
      }
    }

    const id = window.setInterval(() => void check(), WALLET_POLL_MS);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [state.status]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [notice]);

  const value = useMemo<WalletContextValue>(
    () => ({ ...state, connect, disconnect }),
    [state, connect, disconnect]
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
        {notice && (
          <div className="pointer-events-auto rounded-lg border border-pm-violet/30 bg-pm-bg/95 px-4 py-2.5 text-xs text-pm-text shadow-lg">
            {notice}
          </div>
        )}
      </div>
    </WalletContext.Provider>
  );
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

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import { WALLET_ADAPTERS, getAdapter, setActiveAdapter, type WalletAdapter, type WalletAdapterId } from "./adapters";

export type WalletStatus = "idle" | "connecting" | "connected" | "error";

interface WalletState {
  status: WalletStatus;
  address: string | null;
  network: string | null;
  /** Needed to sign transactions via the wallet and to submit them to the matching Soroban RPC. */
  networkPassphrase: string | null;
  /** True once we've finished the initial "was this dApp already authorized?" check. */
  ready: boolean;
  /** At least one supported wallet was detected (vs. none installed). */
  installed: boolean;
  error: string | null;
}

interface WalletContextValue extends WalletState {
  /** Which wallet the current session is connected through, or null. */
  adapterId: WalletAdapterId | null;
  /** Supported wallets detected in this browser. */
  availableWallets: readonly WalletAdapter[];
  /** All supported wallets, installed or not. */
  wallets: readonly WalletAdapter[];
  /** True when the connected wallet has been inactive past the idle timeout; submissions must call `ensureActive` first. */
  idle: boolean;
  /**
   * Resolves true immediately when the session is active; when idle, prompts
   * the user to re-confirm and resolves true only once they do (false if cancelled/failed).
   */
  ensureActive: () => Promise<boolean>;
  /** User-declared flag that the wallet signs via a Ledger (UX hint only). */
  hardwareWallet: boolean;
  setHardwareWallet: (value: boolean) => void;
  /**
   * Requests access via the given wallet (default: first detected). Resolves
   * with the connected address on success, or `null` if the wallet is missing,
   * the request was declined, or it failed. Failures are still recorded into
   * `state.error` so `WalletButton` keeps rendering them unchanged.
   */
  connect: (adapterId?: WalletAdapterId) => Promise<string | null>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const STORAGE_KEY = "refract:wallet-connected";
const ADAPTER_KEY = "refract:wallet-adapter";
const HARDWARE_KEY = "refract:wallet-hardware";

const INITIAL_STATE: WalletState = {
  status: "idle",
  address: null,
  network: null,
  networkPassphrase: null,
  ready: false,
  installed: false,
  error: null,
};

function anyInstalled(): boolean {
  return WALLET_ADAPTERS.some((a) => a.isAvailable());
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<WalletState>(INITIAL_STATE);
  const [adapterId, setAdapterId] = useState<WalletAdapterId | null>(null);
  const [hardwareWallet, setHardwareWalletState] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const confirmResolver = useRef<((ok: boolean) => void) | null>(null);

  const connected = state.status === "connected";
  const { idle, reset: resetIdle } = useIdleTimer({ enabled: connected });

  // On mount: silently rehydrate a previously-granted connection (no popup) —
  // only if the stored wallet is present and still authorizes this dApp.
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const installed = anyInstalled();
      try {
        setHardwareWalletState(localStorage.getItem(HARDWARE_KEY) === "1");
        const wasConnectedHere = localStorage.getItem(STORAGE_KEY) === "1";
        // Sessions saved before multi-wallet support carry no adapter key and were Freighter.
        const adapter = getAdapter((localStorage.getItem(ADAPTER_KEY) as WalletAdapterId | null) ?? "freighter");
        if (!wasConnectedHere || !adapter.isAvailable()) {
          if (!cancelled) setState((s) => ({ ...s, ready: true, installed }));
          return;
        }

        const address = await adapter.getAddress();
        if (cancelled) return;
        if (!address) {
          setState((s) => ({ ...s, ready: true, installed }));
          return;
        }
        const { network, networkPassphrase } = await adapter.getNetwork();
        if (cancelled) return;
        setActiveAdapter(adapter.id);
        setAdapterId(adapter.id);
        setState({ status: "connected", address, network, networkPassphrase, ready: true, installed, error: null });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, ready: true, installed }));
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async (requested?: WalletAdapterId): Promise<string | null> => {
    const adapter = requested
      ? getAdapter(requested)
      : (WALLET_ADAPTERS.find((a) => a.isAvailable()) ?? getAdapter("freighter"));
    if (!adapter.isAvailable()) {
      setState((s) => ({
        ...s,
        status: "error",
        installed: anyInstalled(),
        error: `${adapter.name} extension not detected`,
      }));
      return null;
    }

    setState((s) => ({ ...s, status: "connecting", error: null }));
    try {
      const address = await adapter.connect();
      const { network, networkPassphrase } = await adapter.getNetwork();
      localStorage.setItem(STORAGE_KEY, "1");
      localStorage.setItem(ADAPTER_KEY, adapter.id);
      setActiveAdapter(adapter.id);
      setAdapterId(adapter.id);
      setState({ status: "connected", address, network, networkPassphrase, ready: true, installed: true, error: null });
      return address;
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
    // Wallets have no dApp-initiated "revoke" call — disconnecting here just
    // forgets the local session. Re-connecting will re-prompt the extension.
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ADAPTER_KEY);
    setAdapterId(null);
    setState((s) => ({ ...s, status: "idle", address: null, network: null, networkPassphrase: null, error: null }));
  }, []);

  const setHardwareWallet = useCallback((value: boolean) => {
    setHardwareWalletState(value);
    try {
      localStorage.setItem(HARDWARE_KEY, value ? "1" : "0");
    } catch {
      // storage unavailable — flag just won't persist.
    }
  }, []);

  const settle = useCallback((ok: boolean) => {
    confirmResolver.current?.(ok);
    confirmResolver.current = null;
    setConfirming(false);
    setConfirmError(null);
  }, []);

  const ensureActive = useCallback((): Promise<boolean> => {
    if (!idle) return Promise.resolve(true);
    // Supersede any prompt that's already open.
    confirmResolver.current?.(false);
    return new Promise<boolean>((resolve) => {
      confirmResolver.current = resolve;
      setConfirmError(null);
      setConfirming(true);
    });
  }, [idle]);

  const reconfirm = useCallback(async () => {
    if (!adapterId) return settle(false);
    try {
      // Lightweight check: the wallet must still report the same account.
      const address = await getAdapter(adapterId).getAddress();
      if (address && address === state.address) {
        resetIdle();
        settle(true);
      } else {
        setConfirmError("Your wallet is locked or switched accounts. Unlock it, or disconnect and reconnect.");
      }
    } catch {
      setConfirmError("Couldn't reach your wallet. Try again.");
    }
  }, [adapterId, state.address, resetIdle, settle]);

  const value = useMemo<WalletContextValue>(
    () => ({
      ...state,
      adapterId,
      availableWallets: WALLET_ADAPTERS.filter((a) => a.isAvailable()),
      wallets: WALLET_ADAPTERS,
      idle: connected && idle,
      ensureActive,
      hardwareWallet,
      setHardwareWallet,
      connect,
      disconnect,
    }),
    // `installed` changes whenever availability is re-evaluated, which keeps availableWallets fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, adapterId, connected, idle, ensureActive, hardwareWallet, setHardwareWallet, connect, disconnect]
  );

  return (
    <WalletContext.Provider value={value}>
      {children}
      <Modal open={confirming} onClose={() => settle(false)} title="Still there?">
        <p className="text-[13px] text-pm-text/70">
          You&apos;ve been inactive for a while. Confirm it&apos;s still you before sending another transaction.
        </p>
        {confirmError && (
          <p role="alert" className="mt-3 text-[12px] text-pm-red">
            {confirmError}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="pm-btn pm-btn-outline pm-btn-sm" onClick={() => settle(false)}>
            Cancel
          </button>
          <button type="button" className="pm-btn pm-btn-primary pm-btn-sm" onClick={() => void reconfirm()}>
            I&apos;m still here
          </button>
        </div>
      </Modal>
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

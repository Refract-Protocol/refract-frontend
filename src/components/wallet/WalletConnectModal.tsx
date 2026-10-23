"use client";

import { useEffect, useSyncExternalStore } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Modal } from "@/components/ui/Modal";
import {
  cancelWalletConnect,
  getWalletConnectState,
  subscribeWalletConnect,
} from "@/lib/wallet/adapters/walletconnect";

const SERVER_STATE = { status: "idle", uri: null, message: null } as const;

export function WalletConnectModal() {
  const state = useSyncExternalStore(
    subscribeWalletConnect,
    getWalletConnectState,
    () => SERVER_STATE
  );
  const open =
    state.status === "pending" || state.status === "rejected" || state.status === "timed-out";
  const mobile =
    typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  useEffect(() => {
    if (state.status !== "pending") return;
    return () => {
      void cancelWalletConnect();
    };
  }, [state.status]);

  return (
    <Modal open={open} onClose={() => void cancelWalletConnect()} title="Connect a mobile wallet">
      {state.status === "pending" && state.uri ? (
        <div className="flex flex-col items-center gap-4 text-center">
          {mobile ? (
            <a className="pm-btn pm-btn-primary" href={state.uri}>
              Open wallet
            </a>
          ) : (
            <div className="rounded-xl bg-white p-3" aria-label="WalletConnect QR code">
              <QRCodeSVG value={state.uri} size={220} level="M" />
            </div>
          )}
          <p className="text-[13px] text-pm-text/70">
            {mobile
              ? "Open a WalletConnect-compatible Stellar wallet to approve."
              : "Scan with a WalletConnect-compatible Stellar wallet."}
          </p>
          <p className="text-[11px] text-pm-muted">This request expires after two minutes.</p>
        </div>
      ) : (
        <div>
          <p role="alert" className="text-[13px] text-pm-red">
            {state.message}
          </p>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              className="pm-btn pm-btn-outline pm-btn-sm"
              onClick={() => void cancelWalletConnect()}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

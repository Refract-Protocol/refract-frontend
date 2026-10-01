"use client";

import { useEffect, useState } from "react";
import { useNetworkGuard } from "@/hooks/useNetworkGuard";

/**
 * Warns when the connected wallet is on the wrong network. Dismissing hides
 * it only until the wallet's network changes again. Freighter has no public
 * network-switch API, so this gives manual instructions instead.
 */
export function WrongNetworkBanner() {
  const { isCorrectNetwork, expectedNetwork, currentNetwork } = useNetworkGuard();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => setDismissed(false), [currentNetwork]);

  if (isCorrectNetwork || dismissed) return null;

  return (
    <div
      role="alert"
      className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-pm-amber/30 bg-pm-amber/[0.08] px-4 py-3 text-[13px] text-pm-amber"
    >
      <p className="m-0 leading-relaxed">
        <strong>Wrong network.</strong> Your wallet is on {currentNetwork ?? "an unknown network"}, but Refract runs on{" "}
        {expectedNetwork}. Open the Freighter extension, click the network selector at the top, and switch to{" "}
        {expectedNetwork} — this page updates automatically.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss wrong network warning"
        className="shrink-0 text-pm-amber/70 hover:text-pm-amber"
      >
        ✕
      </button>
    </div>
  );
}

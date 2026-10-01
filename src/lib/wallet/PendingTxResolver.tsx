"use client";

import { useEffect } from "react";
import { resolvePendingTx } from "@/lib/wallet/signAndSubmit";

/** Fires once on app startup to reconcile any transaction signed but not confirmed before a refresh. */
export function PendingTxResolver() {
  useEffect(() => {
    void resolvePendingTx();
  }, []);
  return null;
}

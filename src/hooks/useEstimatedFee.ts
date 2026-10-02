"use client";

import { useEffect, useState } from "react";
import { estimateFeeStroops, fetchInclusionFee, formatFeeXlm, type TxKind } from "@/lib/stellar/fees";

/**
 * Estimated network fee for a tx kind, formatted for display (e.g.
 * "~0.0151 XLM"), or null while loading / if Horizon's fee stats are
 * unavailable — callers should hide the line item when null.
 */
export function useEstimatedFee(kind: TxKind): string | null {
  const [fee, setFee] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchInclusionFee().then((inclusionFee) => {
      if (cancelled) return;
      setFee(inclusionFee === null ? null : formatFeeXlm(estimateFeeStroops(kind, inclusionFee)));
    });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  return fee;
}

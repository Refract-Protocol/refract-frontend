"use client";

import { useEffect, useRef, useState } from "react";

import { useRealtimeTopic } from "@/lib/realtime/useRealtimeTopic";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";

export const QUOTE_TOPIC = "quote";
const FRESH_MS = 15_000;
const JUST_NOW_MS = 3_000;

/** Backend push shape for the `quote` topic. */
export interface QuotePush {
  typeId: number;
  durationDays: number;
  baseRatePct: number;
  utilizationPct?: number;
  capacityRemaining?: number;
}

/**
 * Live quote for the selected risk class + duration, merged over the REST
 * rate: a push for another class/duration is ignored, and a push older than
 * 15s falls back to REST and reports `stale`. While `paused` (after the user
 * clicks confirm) pushes are discarded.
 */
export function useLiveQuote(typeId: number | undefined, durationDays: number, paused: boolean) {
  const enabled = useFeatureFlag("realtime-quotes");
  const { data, receivedAt } = useRealtimeTopic<QuotePush>(QUOTE_TOPIC, enabled && !paused);
  const [tick, setTick] = useState(0);
  const accepted = useRef<{ push: QuotePush; at: number } | null>(null);

  if (
    data &&
    receivedAt &&
    data.typeId === typeId &&
    data.durationDays === durationDays &&
    !paused
  ) {
    if (accepted.current?.at !== receivedAt) accepted.current = { push: data, at: receivedAt };
  }
  if (
    accepted.current &&
    (accepted.current.push.typeId !== typeId || accepted.current.push.durationDays !== durationDays)
  ) {
    accepted.current = null;
  }

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(id);
  }, [enabled]);
  void tick;

  const age = accepted.current ? Date.now() - accepted.current.at : null;
  const live = age !== null && age <= FRESH_MS ? accepted.current!.push : null;
  return {
    quote: live,
    justUpdated: age !== null && age <= JUST_NOW_MS,
    /** Realtime enabled but no fresh push: the REST quote is being shown. */
    stale: enabled && !live,
  };
}

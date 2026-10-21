"use client";
import { useEffect, useState } from "react";
import { realtimeClient } from "./client";
import { isRealtimeDisabled, subscribeKillSwitch } from "./killSwitch";

/** Best-effort updates only. Consumers must keep their REST query as source of truth. */
export function useRealtimeTopic<T = unknown>(topic: string): T | null {
  const [payload, setPayload] = useState<T | null>(null);
  useEffect(() => {
    if (isRealtimeDisabled()) return;
    const clear = () => setPayload(null);
    const clearWhenHidden = () => {
      if (document.visibilityState === "hidden") clear();
    };
    const unsubscribe = realtimeClient.subscribe(topic, (value) => setPayload(value as T));
    const stopWatching = subscribeKillSwitch(({ disabled }) => {
      if (disabled) {
        unsubscribe();
        setPayload(null);
      }
    });
    window.addEventListener("pagehide", clear);
    window.addEventListener("freeze", clear);
    document.addEventListener("visibilitychange", clearWhenHidden);
    return () => {
      unsubscribe();
      stopWatching();
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("freeze", clear);
      document.removeEventListener("visibilitychange", clearWhenHidden);
    };
  }, [topic]);
  return payload;
}

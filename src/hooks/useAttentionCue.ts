"use client";

import { useCallback, useEffect, useRef } from "react";

import { AttentionCueService } from "@/lib/attentionCue";
import { usePreferencesStore } from "@/lib/store/preferencesStore";
import type { RefractNotification } from "@/lib/notifications";

/** Requests audio/haptic cues for critical notifications that appear after first load. */
export function useAttentionCue(notifications: RefractNotification[]) {
  const service = useRef<AttentionCueService | null>(null);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const svc = new AttentionCueService({
      enabled: () => usePreferencesStore.getState().attentionCues,
      now: () => new Date(),
    });
    service.current = svc;
    const unlock = () => svc.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      svc.dispose();
      service.current = null;
    };
  }, []);

  useEffect(() => {
    const ids = new Set(notifications.map((n) => n.id));
    // First emission is existing/backfilled state: seed, don't cue.
    if (seen.current) {
      const fresh = notifications.filter((n) => !seen.current!.has(n.id) && !n.read);
      for (const n of fresh) service.current?.cue(n.severity);
    }
    seen.current = ids;
  }, [notifications]);

  return { unlock: useCallback(() => service.current?.unlock(), []) };
}

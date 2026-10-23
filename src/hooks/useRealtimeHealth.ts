"use client";

import { useEffect, useState } from "react";

import {
  realtimeHealth,
  RealtimeStatus,
  type RealtimeHealthSnapshot,
} from "../lib/realtime/health";

export { RealtimeStatus };
export type { RealtimeHealthSnapshot };

/**
 * Subscribe to realtime connection health. Backed by the observable
 * `realtimeHealth` store so React re-renders on transitions rather than
 * polling. `lastMessageAgeMs` is derived at read time from `lastMessageAt`.
 */
export function useRealtimeHealth(): RealtimeHealthSnapshot {
  const [snapshot, setSnapshot] = useState<RealtimeHealthSnapshot>(() =>
    realtimeHealth.getSnapshot(),
  );

  useEffect(() => {
    const unsubscribe = realtimeHealth.subscribe((event) => {
      setSnapshot(event.snapshot);
    });
    // Sync in case the store changed between render and subscription.
    setSnapshot(realtimeHealth.getSnapshot());
    return unsubscribe;
  }, []);

  const lastMessageAgeMs =
    snapshot.lastMessageAt === null ? null : Date.now() - snapshot.lastMessageAt;

  return { ...snapshot, lastMessageAgeMs };
}
}

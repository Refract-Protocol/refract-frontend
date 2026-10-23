"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { pollIntervalFor, StableHealth, type PollTier } from "@/lib/polling/adaptivePolling";
import { realtimeClient } from "@/lib/realtime/client";
import type { HealthSource, RealtimeHealth } from "@/lib/realtime/health";

interface UseAdaptivePollingOptions {
  /** Realtime topic that pushes this data; its health drives the cadence. */
  topic: string;
  tier: PollTier;
  /** Query whose in-flight request is cancelled when realtime recovers. */
  queryKey?: QueryKey;
  /** Injectable for tests; defaults to the app's realtime client health. */
  health?: HealthSource;
}

/**
 * Returns a TanStack `refetchInterval` that follows realtime health for
 * `topic` (see src/lib/polling/adaptivePolling.ts for the policy). TanStack
 * already pauses interval refetches while the tab is hidden
 * (`refetchIntervalInBackground` defaults to false).
 */
export function useAdaptivePolling({
  topic,
  tier,
  queryKey,
  health,
}: UseAdaptivePollingOptions): number | false {
  const queryClient = useQueryClient();
  const source = health ?? realtimeClient.health;
  const [current, setCurrent] = useState<RealtimeHealth>(() => source.get(topic));
  const keyRef = useRef(queryKey);
  keyRef.current = queryKey;

  useEffect(() => {
    const stable = new StableHealth(source, topic);
    setCurrent(stable.get());
    const unsubscribe = stable.subscribe(() => {
      const next = stable.get();
      setCurrent(next);
      if (next === "healthy" && keyRef.current) {
        // Realtime is delivering again: cancel the poll that's mid-flight.
        void queryClient.cancelQueries({ queryKey: keyRef.current });
      }
    });
    return () => {
      unsubscribe();
      stable.dispose();
    };
  }, [source, topic, queryClient]);

  return pollIntervalFor(tier, current);
}

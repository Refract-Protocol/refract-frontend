"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { realtimeClient, REALTIME_TOPICS } from "@/lib/realtime/client";
import { TOPIC_TO_QUERY_KEYS, TOPIC_ANNOUNCEMENTS, type RealtimeTopic } from "@/lib/realtime/topics";
import { useAriaLive } from "@/components/ui/AriaLiveProvider";

/**
 * Subscribes to every realtime topic and:
 *
 * 1. **Invalidates** the corresponding TanStack Query cache entries so
 *    rendered data refreshes from the REST endpoint.
 * 2. **Announces** the event via the throttled ARIA live region so
 *    screen-reader users learn about meaningful changes (a claim settled,
 *    an oracle reading moved, a policy was issued) rather than relying on
 *    visual-only DOM mutation.
 *
 * This is the bridge between the push-based WebSocket transport
 * (`RealtimeClient`) and the pull-based REST cache that hooks read from.
 * Without it, a streamed oracle reading, claim settlement, or pool-stats
 * update would update the ring buffer but leave the rendered data stale
 * until the next manual refetch.
 *
 * Query keys are matched by prefix — invalidating `["oracle"]` refreshes
 * every query whose key starts with `["oracle", …]`.
 *
 * Must be mounted inside `QueryClientProvider` and `AriaLiveProvider`.
 */
export function RealtimeSyncProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { announce } = useAriaLive();

  useEffect(() => {
    const topics = Object.values(REALTIME_TOPICS) as RealtimeTopic[];
    const unsubscribers = topics.map((topic) =>
      realtimeClient.subscribe(topic, () => {
        const keys = TOPIC_TO_QUERY_KEYS[topic];
        for (const key of keys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
        // Announce via the throttled ARIA live region.
        announce(TOPIC_ANNOUNCEMENTS[topic]);
      }),
    );

    return () => {
      for (const unsub of unsubscribers) unsub();
    };
  }, [queryClient, announce]);

  return <>{children}</>;
}

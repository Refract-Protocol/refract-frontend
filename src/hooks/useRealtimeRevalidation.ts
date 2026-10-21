"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { realtimeClient } from "@/lib/realtime/client";
import { createRefreshScheduler, TOPIC_REVALIDATION_TAGS } from "@/lib/realtime/revalidation";

/**
 * Refreshes the current route's Server Components when realtime topics that
 * feed them push events. router.refresh() preserves client state, scroll and
 * subscriptions. Mount once near the app root.
 */
export function useRealtimeRevalidation({
  enabled = true,
  isBlocked,
}: { enabled?: boolean; isBlocked?: () => boolean } = {}) {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const scheduler = createRefreshScheduler({
      refresh: () => router.refresh(),
      enabled: () => enabled,
      isBlocked,
      log: (m) => console.debug(m),
    });
    const unsubs = Object.keys(TOPIC_REVALIDATION_TAGS).map((topic) =>
      realtimeClient.subscribe(topic, () => scheduler.notify(topic))
    );
    return () => {
      unsubs.forEach((u) => u());
      scheduler.cancel();
    };
  }, [router, enabled, isBlocked]);
}

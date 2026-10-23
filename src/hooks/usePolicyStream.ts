import { useEffect, useMemo } from "react";
import { loadRealtime } from "@/lib/realtime/load";
import type { PolicyEvent } from "@/lib/realtime/policyEvents";
import {
  isTerminal,
  PENDING_POLICIES_STORAGE_KEY,
  PENDING_WAIT_MS,
  usePendingPolicyStore,
  type PendingPolicy,
} from "@/lib/realtime/pendingPolicies";
import { policyTopic } from "@/lib/realtime/topics";

/** The parts of the lazily-loaded realtime module this hook uses. */
export interface PolicyStreamModule {
  getRealtimeClient(): {
    subscribe(topic: string, handler: (payload: unknown) => void): () => void;
  };
  parsePolicyEvent(payload: unknown): PolicyEvent | null;
}

export interface UsePolicyStreamOptions {
  /**
   * Loads the realtime module. Defaults to `loadRealtime()`, so the client
   * and the payload validator stay out of the initial bundle. Must be stable.
   */
  load?: () => Promise<PolicyStreamModule>;
}

/**
 * Streams `policy.<address>` into the pending-policy store (issue #246).
 *
 * Subscribes while the wallet has at least one unsettled purchase (so on
 * submit, or on mount when one is already pending) and unsubscribes once all
 * have settled. Each unsettled entry also gets a bounded wait: if no event
 * settles it within `PENDING_WAIT_MS`, the REST result stands.
 *
 * Returns this wallet's entries, newest first.
 */
export function usePolicyStream(
  address: string | null | undefined,
  options: UsePolicyStreamOptions = {}
): PendingPolicy[] {
  const all = usePendingPolicyStore((s) => s.entries);
  const applyEvent = usePendingPolicyStore((s) => s.applyEvent);
  const settle = usePendingPolicyStore((s) => s.settleViaRest);
  const load = options.load ?? loadRealtime;

  const entries = useMemo(
    () => (address ? all.filter((p) => p.holder === address) : []),
    [all, address]
  );
  const unsettled = entries.filter((p) => !isTerminal(p.status));
  const hasUnsettled = unsettled.length > 0;
  // Re-arm timers only when the set of unsettled entries changes.
  const unsettledKey = unsettled.map((p) => `${p.key}:${p.createdAt}`).join("|");

  // Live subscription.
  useEffect(() => {
    if (!address || !hasUnsettled) return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    load()
      .then(({ getRealtimeClient, parsePolicyEvent }) => {
        if (cancelled) return;
        unsubscribe = getRealtimeClient().subscribe(policyTopic(address), (payload) => {
          const event = parsePolicyEvent(payload);
          // Malformed payloads and events for another wallet are ignored.
          if (event && event.holder === address) applyEvent(event);
        });
      })
      .catch(() => {
        // Realtime unavailable: the bounded wait below still settles entries.
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // `load` is expected to be stable (module-level or memoized).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, hasUnsettled, applyEvent]);

  // Bounded wait per unsettled entry.
  useEffect(() => {
    if (!unsettledKey) return;
    const now = Date.now();
    const timers = unsettled.map((p) =>
      setTimeout(() => settle(p.key), Math.max(0, p.createdAt + PENDING_WAIT_MS - now))
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsettledKey, settle]);

  // Cross-tab sync: another tab bought or settled a policy.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PENDING_POLICIES_STORAGE_KEY) void usePendingPolicyStore.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return entries;
}

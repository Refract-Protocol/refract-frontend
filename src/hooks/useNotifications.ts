"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useHolderPolicies } from "./useHolderPolicies";
import { useClaims } from "./useClaims";
import { useLockupStatus } from "./useLockupStatus";
import { useOracleStatus } from "./useOracleStatus";
import { deriveNotifications, type RefractNotification } from "@/lib/notifications";
import { useFeatureFlag } from "@/lib/flags/useFeatureFlag";
import { realtimeClient, type RealtimeState } from "@/lib/realtime/client";
import { markNotificationRead } from "@/lib/api/notifications";
import { mergeNotifications, normalizeNotification } from "@/lib/realtime/notifications";

const STORAGE_KEY = "refract_read_notifications_v1";
export function useNotifications() {
  const wallet = useWallet();
  const address = wallet.status === "connected" ? wallet.address : null;
  const enabled = useFeatureFlag("realtime-notifications");
  const { data: policies } = useHolderPolicies(address);
  const claims = useClaims(address, policies);
  const { lockupExpiresAt } = useLockupStatus(address);
  const { data: oracleReadings } = useOracleStatus();
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [pushed, setPushed] = useState<RefractNotification[]>([]);
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    setPushed([]);
    if (!address) {
      setReadIds(new Set());
      return;
    }
    try {
      const stored = localStorage.getItem(`${STORAGE_KEY}:${address}`);
      setReadIds(new Set(stored ? (JSON.parse(stored) as string[]) : []));
    } catch {
      setReadIds(new Set());
    }
  }, [address]);

  useEffect(() => {
    realtimeClient.setIdentity(address);
    if (!enabled || !address) {
      setIsStale(false);
      return;
    }
    return realtimeClient.subscribe(
      "notifications",
      (payload) => {
        const notification = normalizeNotification(payload);
        if (!notification) return;
        setPushed((current) => mergeNotifications(current, notification));
      },
      { authenticated: true, onState: (state: RealtimeState) => setIsStale(state !== "live") }
    );
  }, [enabled, address]);

  const saveReadIds = useCallback(
    (next: Set<string>) => {
      setReadIds(next);
      if (!address) return;
      try {
        localStorage.setItem(`${STORAGE_KEY}:${address}`, JSON.stringify([...next]));
      } catch {
        /* storage is optional */
      }
    },
    [address]
  );

  const notifications = useMemo(() => {
    const derived = deriveNotifications({
      policies,
      claims,
      lockupExpiresAt,
      oracleReadings,
      readIds,
    });
    const byId = new Map(derived.map((item) => [item.id, item]));
    for (const item of pushed)
      byId.set(item.id, { ...item, read: readIds.has(item.id) || item.read });
    return [...byId.values()].sort((a, b) => b.timestamp - a.timestamp);
  }, [policies, claims, lockupExpiresAt, oracleReadings, readIds, pushed]);

  const markAsRead = useCallback(
    (id: string) => {
      const wasRead = readIds.has(id);
      if (!wasRead) saveReadIds(new Set([...readIds, id]));
      void markNotificationRead(id).catch(() => {
        if (!wasRead)
          setReadIds((current) => {
            const next = new Set(current);
            next.delete(id);
            try {
              if (address)
                localStorage.setItem(`${STORAGE_KEY}:${address}`, JSON.stringify([...next]));
            } catch {
              /* optional */
            }
            return next;
          });
      });
    },
    [address, readIds, saveReadIds]
  );

  const markAllAsRead = useCallback(() => {
    const ids = notifications.map((item) => item.id);
    const previous = readIds;
    const next = new Set([...readIds, ...ids]);
    saveReadIds(next);
    void Promise.all(ids.map((id) => markNotificationRead(id))).catch(() => {
      setReadIds(previous);
      if (address)
        try {
          localStorage.setItem(`${STORAGE_KEY}:${address}`, JSON.stringify([...previous]));
        } catch {
          /* optional */
        }
    });
  }, [address, notifications, readIds, saveReadIds]);

  return {
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
    markAsRead,
    markAllAsRead,
    isStale,
  };
}

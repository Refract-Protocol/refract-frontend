"use client";

import { useEffect, useMemo, useState } from "react";
import { realtimeClient } from "@/lib/realtime/client";
import { mergeNotifications } from "@/lib/notificationGroups";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useHolderPolicies } from "./useHolderPolicies";
import { useClaims } from "./useClaims";
import { useLockupStatus } from "./useLockupStatus";
import { useOracleStatus } from "./useOracleStatus";
import { useAdaptivePolling } from "./useAdaptivePolling";
import { deriveNotifications, type RefractNotification } from "@/lib/notifications";

const STORAGE_KEY = "refract_read_notifications_v1";

export function useNotifications() {
  const wallet = useWallet();
  const address = wallet.status === "connected" ? wallet.address : null;

  const { data: policies } = useHolderPolicies(address);
  const claims = useClaims(address, policies);
  const { lockupExpiresAt } = useLockupStatus(address);
  const { data: oracleReadings } = useOracleStatus();

  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [pushed, setPushed] = useState<RefractNotification[]>([]);

  useEffect(() => {
    return realtimeClient.subscribe("notifications" as any, (payload: unknown) => {
      const item = payload as Partial<RefractNotification> | null;
      if (!item || typeof item.id !== "string" || typeof item.timestamp !== "number") return;
      setPushed((prev) => mergeNotifications([item as RefractNotification], prev));
    });
  }, []);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        setReadIds(new Set(JSON.parse(e.newValue)));
      } catch {
        // Ignore malformed value
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const tickInterval = useAdaptivePolling({ topic: "holder_claim", tier: "background" });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (tickInterval === false) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setNow(Date.now());
    }, tickInterval);
    return () => clearInterval(id);
  }, [tickInterval]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setReadIds(new Set(JSON.parse(stored)));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  const saveReadIds = (newSet: Set<string>) => {
    setReadIds(newSet);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(newSet)));
    } catch {
      // Ignore
    }
  };

  const notifications = useMemo(() => {
    const derived = deriveNotifications({
      policies,
      claims,
      lockupExpiresAt,
      oracleReadings,
      readIds,
      now,
    });
    return mergeNotifications(
      pushed.map((n) => ({ ...n, read: readIds.has(n.id) })),
      derived
    );
  }, [policies, claims, lockupExpiresAt, oracleReadings, readIds, pushed, now]);

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !n.read).length;
  }, [notifications]);

  const markAsRead = (id: string) => {
    const updated = new Set(readIds);
    updated.add(id);
    saveReadIds(updated);
  };

  const markAllAsRead = () => {
    const updated = new Set(readIds);
    for (const n of notifications) {
      updated.add(n.id);
    }
    saveReadIds(updated);
  };

  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
  };
}

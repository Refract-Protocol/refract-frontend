"use client";

import { useEffect, useMemo, useState } from "react";
import { realtimeClient } from "@/lib/realtime/client";
import { mergeNotifications } from "@/lib/notificationGroups";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useHolderPolicies } from "./useHolderPolicies";
import { useClaims } from "./useClaims";
import { useLockupStatus } from "./useLockupStatus";
import { useOracleStatus } from "./useOracleStatus";
import {
  deriveNotifications,
  type RefractNotification,
} from "@/lib/notifications";

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

  // Realtime delivers new items; REST-derived items below supply history.
  // If the topic is disabled or unhealthy nothing arrives and REST still works.
  useEffect(() => {
    return realtimeClient.subscribe("notifications", (payload) => {
      const item = payload as Partial<RefractNotification> | null;
      if (!item || typeof item.id !== "string" || typeof item.timestamp !== "number") return;
      setPushed((prev) => mergeNotifications([item as RefractNotification], prev));
    });
  }, []);

  // Reflect read state changes made in other tabs.
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
    });
    return mergeNotifications(
      pushed.map((n) => ({ ...n, read: readIds.has(n.id) })),
      derived
    );
  }, [policies, claims, lockupExpiresAt, oracleReadings, readIds, pushed]);

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

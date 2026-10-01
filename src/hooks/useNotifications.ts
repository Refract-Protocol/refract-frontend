"use client";

import { useEffect, useMemo, useState } from "react";
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
    return deriveNotifications({
      policies,
      claims,
      lockupExpiresAt,
      oracleReadings,
      readIds,
    });
  }, [policies, claims, lockupExpiresAt, oracleReadings, readIds]);

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

"use client";

import { useEffect, useRef, useState } from "react";
import { realtimeClient, type RealtimeStatus } from "@/lib/realtime/client";
import {
  isPresenceFresh,
  pushActivity,
  sanitizeActivity,
  sanitizePresence,
  PRESENCE_TTL_MS,
} from "@/lib/realtime/poolActivity";
import type { PoolActivityEvent } from "@/lib/realtime/topics";

const FLUSH_MS = 500;

interface PoolActivityState {
  feed: PoolActivityEvent[];
  /** Providers active now, or null when the topic is unavailable / idle. */
  presence: number | null;
  status: RealtimeStatus;
}

/**
 * Live pool activity feed + aggregate presence. Presence is ephemeral and
 * lives only in this hook's state (expired client-side by timer); the feed is
 * a bounded ring buffer flushed at most every FLUSH_MS to throttle renders.
 */
export function usePoolActivity(): PoolActivityState {
  const [feed, setFeed] = useState<PoolActivityEvent[]>([]);
  const [presence, setPresence] = useState<{ active: number; at: number } | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>(realtimeClient.getStatus());
  const [now, setNow] = useState(() => Date.now());
  const pending = useRef<PoolActivityEvent[]>([]);

  useEffect(() => {
    const flush = setInterval(() => {
      if (pending.current.length === 0) return;
      const batch = pending.current;
      pending.current = [];
      setFeed((prev) => batch.reduce((acc, e) => pushActivity(acc, e), prev));
    }, FLUSH_MS);
    const tick = setInterval(() => setNow(Date.now()), PRESENCE_TTL_MS / 4);

    const offActivity = realtimeClient.subscribe("pool_activity", (raw) => {
      const event = sanitizeActivity(raw);
      if (event) pending.current.push(event);
    });
    const offPresence = realtimeClient.subscribe("pool_presence", (raw) => {
      const active = sanitizePresence(raw);
      if (active !== null) {
        setPresence({ active, at: Date.now() });
        setNow(Date.now());
      }
    });
    const offStatus = realtimeClient.onStatus(setStatus);
    setStatus(realtimeClient.getStatus());

    return () => {
      clearInterval(flush);
      clearInterval(tick);
      offActivity();
      offPresence();
      offStatus();
    };
  }, []);

  return {
    feed,
    presence: presence && isPresenceFresh(presence.at, now) ? presence.active : null,
    status,
  };
}

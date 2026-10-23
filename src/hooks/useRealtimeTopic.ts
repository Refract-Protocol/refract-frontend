"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  realtimeClient,
  type EventMeta,
  type GapInfo,
  type RealtimeClient,
  type RealtimeStatus,
} from "@/lib/realtime/client";
import { descriptor, type Interest, type Topic } from "@/lib/realtime/contract";

export interface UseRealtimeTopicOptions<T> {
  enabled?: boolean;
  /** Defaults to the app-wide singleton; inject for tests. */
  client?: RealtimeClient;
  /** Narrow the untyped payload; return null to ignore it. */
  select?: (payload: unknown) => T | null;
  /** Called once per de-duplicated event, in order. */
  onEvent?: (value: T, meta: EventMeta) => void;
  /**
   * Called when events may have been missed (resume gap or sequence jump).
   * Refetch the REST snapshot here.
   */
  onGap?: (gap: GapInfo) => void;
}

export interface UseRealtimeTopicResult<T> {
  /** Most recent event value, or null before the first event. */
  latest: T | null;
  status: RealtimeStatus;
  /** True when realtime is unavailable and callers should poll REST. */
  degraded: boolean;
}

/**
 * Subscribes a component to one realtime topic. The client has already
 * decoded, validated and de-duplicated every event before it reaches here,
 * so `onEvent` fires exactly once per event id.
 */
export function useRealtimeTopic<T = unknown>(
  topic: string,
  options: UseRealtimeTopicOptions<T> = {}
): UseRealtimeTopicResult<T> {
  const { enabled = true, client = realtimeClient } = options;
  const [latest, setLatest] = useState<T | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const status = useSyncExternalStore(
    (onChange) => client.onStatusChange(onChange),
    () => client.status,
    () => "idle" as RealtimeStatus
  );

  useEffect(() => {
    if (!enabled) return;
    return client.subscribe(
      topic,
      (payload, meta) => {
        const { select, onEvent } = optionsRef.current;
        const value = select ? select(payload) : (payload as T);
        if (value === null || value === undefined) return;
        setLatest(value);
        onEvent?.(value, meta);
      },
      (gap) => optionsRef.current.onGap?.(gap)
    );
  }, [client, topic, enabled]);

  return { latest, status, degraded: status === "degraded" };
}

/** Fixed refresh window: continuous traffic cannot postpone REST refresh forever. */
export function useRealtimeRevision(topic: Topic, interest: Interest | null) {
  const [revision, setRevision] = useState(0);
  const pending = useRef<ReturnType<typeof setTimeout>>();
  useRealtimeTopic(topic, {
    onEvent: () => {
      if (pending.current !== undefined) return;
      pending.current = setTimeout(() => {
        pending.current = undefined;
        setRevision((n) => n + 1);
      }, 100);
    },
  });
  useEffect(() => () => clearTimeout(pending.current), []);
  return revision;
}
}

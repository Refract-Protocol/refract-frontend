"use client";

import { useEffect, useRef, useState } from "react";
import { realtimeClient } from "@/lib/realtime/client";
import type { Interest, Topic } from "@/lib/realtime/contract";

export interface RealtimeTopicState<T> {
  value: T | undefined;
  /** Alias for `value ?? null` for callers expecting `latest`. */
  latest: T | null;
  /** True while showing a cached value that no live event has replaced yet. */
  stale: boolean;
  receivedAt: number | undefined;
  source: string | undefined;
  sequence: number | undefined;
  status: string;
  degraded: boolean;
}

export interface UseRealtimeTopicOptions<T> {
  enabled?: boolean;
  select?: (payload: unknown) => T | null;
  onEvent?: (value: T, meta?: unknown) => void;
}

/** Seeds from the last-value cache at mount, then follows the live stream. */
export function useRealtimeTopic<T = unknown>(
  topic: string,
  options: UseRealtimeTopicOptions<T> = {}
): RealtimeTopicState<T> {
  const { enabled = true } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [state, setState] = useState<RealtimeTopicState<T>>(() => {
    const cached = realtimeClient.getLastValue<T>(topic);
    return {
      value: cached?.value,
      latest: cached?.value ?? null,
      stale: !!cached,
      receivedAt: cached?.receivedAt,
      source: cached?.source,
      sequence: cached?.sequence,
      status: "idle",
      degraded: false,
    };
  });

  useEffect(() => {
    if (!enabled) return;
    return realtimeClient.subscribe(topic, (payload) => {
      const { select, onEvent } = optionsRef.current;
      const value = select ? select(payload) : (payload as T);
      if (value === null || value === undefined) return;
      const cached = realtimeClient.getLastValue<T>(topic);
      setState({
        value,
        latest: value,
        stale: false,
        receivedAt: cached?.receivedAt ?? Date.now(),
        source: cached?.source,
        sequence: cached?.sequence,
        status: "connected",
        degraded: false,
      });
      onEvent?.(value);
    });
  }, [topic, enabled]);

  return state;
}

/** Fixed refresh window: continuous traffic cannot postpone REST refresh forever. */
export function useRealtimeRevision(topic: Topic, _interest: Interest | null) {
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

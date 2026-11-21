"use client";

import { useEffect, useRef, useState } from "react";
import { realtimeClient, type FrameMeta, type RealtimeClient } from "@/lib/realtime/client";
import type { Interest, Topic, TopicName, TopicPayloads } from "@/lib/realtime/contract";

export interface UseRealtimeTopicOptions<T = unknown> {
  /** Skip subscribing (e.g. no wallet connected for an account-scoped topic). */
  enabled?: boolean;
  /** For account-scoped consumers: only accept frames for this account. */
  account?: string | null;
  client?: RealtimeClient;
  select?: (payload: unknown) => T | null;
  onEvent?: (value: T, meta?: FrameMeta) => void;
}

export interface RealtimeTopicState<T> {
  value: T | undefined;
  latest: T | null;
  stale: boolean;
  receivedAt: number | undefined;
  source: string | undefined;
  sequence: number | undefined;
  status: string;
  degraded: boolean;
}

/**
 * SSR-safe guard: realtime is only available in the browser. Returns false
 * during server rendering / static generation so callers never touch browser
 * globals (WebSocket, EventSource, window, sessionStorage) on the server.
 */
export function isRealtimeAvailable(): boolean {
  return typeof window !== "undefined";
}

export function useRealtimeTopic<T extends TopicName>(
  topic: T,
  onFrame: (payload: TopicPayloads[T], meta: FrameMeta) => void,
  options?: UseRealtimeTopicOptions<TopicPayloads[T]>
): void;
export function useRealtimeTopic<T = unknown>(
  topic: string,
  options?: UseRealtimeTopicOptions<T>
): RealtimeTopicState<T>;
export function useRealtimeTopic<T = unknown>(
  topic: string,
  arg2?: ((payload: any, meta: FrameMeta) => void) | UseRealtimeTopicOptions<T>,
  arg3?: UseRealtimeTopicOptions<any>
): RealtimeTopicState<T> | void {
  const isCallbackOverload = typeof arg2 === "function";
  const onFrame = isCallbackOverload ? arg2 : undefined;
  const options: UseRealtimeTopicOptions<T> = (isCallbackOverload ? arg3 : arg2) ?? {};
  const { enabled = true, account, client = realtimeClient } = options;

  const handlerRef = useRef(onFrame);
  handlerRef.current = onFrame;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Stable default until effects run: never read browser-backed caches during
  // SSR or the initial render, avoiding hydration mismatches.
  const [state, setState] = useState<RealtimeTopicState<T>>(() => ({
    value: undefined,
    latest: null,
    stale: false,
    receivedAt: undefined,
    source: undefined,
    sequence: undefined,
    status: "idle",
    degraded: false,
  }));

  useEffect(() => {
    if (!enabled || !isRealtimeAvailable()) return;
    const cached = client.getLastValue?.<T>(topic);
    if (cached) {
      setState({
        value: cached.value,
        latest: cached.value ?? null,
        stale: true,
        receivedAt: cached.receivedAt,
        source: cached.source,
        sequence: cached.sequence,
        status: "idle",
        degraded: false,
      });
    }
    return client.subscribe(topic as TopicName, (payload, meta) => {
      if (meta && (meta.epoch !== client.getEpoch() || client.isScopeChanging())) return;
      if (meta && account !== undefined && meta.scope.account !== account) return;
      if (handlerRef.current) {
        handlerRef.current(payload, meta);
        return;
      }
      const { select, onEvent } = optionsRef.current;
      const value = select ? select(payload) : (payload as T);
      if (value === null || value === undefined) return;
      const latest = client.getLastValue?.<T>(topic);
      setState({
        value,
        latest: value,
        stale: false,
        receivedAt: latest?.receivedAt ?? Date.now(),
        source: latest?.source,
        sequence: latest?.sequence,
        status: "connected",
        degraded: false,
      });
      onEvent?.(value, meta);
    });
  }, [client, topic, enabled, account]);

  if (!isCallbackOverload) return state;
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

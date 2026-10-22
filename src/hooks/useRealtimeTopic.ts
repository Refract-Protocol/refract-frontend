"use client";

import { useEffect, useRef } from "react";
import { realtimeClient, type FrameMeta, type RealtimeClient } from "@/lib/realtime/client";
import type { TopicName, TopicPayloads } from "@/lib/realtime/contract";

interface UseRealtimeTopicOptions {
  /** Skip subscribing (e.g. no wallet connected for an account-scoped topic). */
  enabled?: boolean;
  /** For account-scoped consumers: only accept frames for this account. */
  account?: string | null;
  client?: RealtimeClient;
}

/**
 * Subscribes to a realtime topic for the lifetime of the component. Frames
 * are only passed on when they belong to the client's current scope epoch
 * (and, when `account` is given, to that account) — so a frame that raced a
 * wallet or network switch is dropped instead of being merged into the new
 * identity's data.
 */
export function useRealtimeTopic<T extends TopicName>(
  topic: T,
  onFrame: (payload: TopicPayloads[T], meta: FrameMeta) => void,
  { enabled = true, account, client = realtimeClient }: UseRealtimeTopicOptions = {}
): void {
  const handlerRef = useRef(onFrame);
  handlerRef.current = onFrame;

  useEffect(() => {
    if (!enabled) return;
    return client.subscribe(topic, (payload, meta) => {
      if (meta.epoch !== client.getEpoch() || client.isScopeChanging()) return;
      if (account !== undefined && meta.scope.account !== account) return;
      handlerRef.current(payload, meta);
    });
  }, [client, topic, enabled, account]);
}

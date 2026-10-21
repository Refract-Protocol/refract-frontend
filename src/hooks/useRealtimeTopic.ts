"use client";

import { useEffect, useState } from "react";
import { realtimeClient } from "@/lib/realtime/client";

export interface RealtimeTopicState<T> {
  value: T | undefined;
  /** True while showing a cached value that no live event has replaced yet. */
  stale: boolean;
  receivedAt: number | undefined;
  source: string | undefined;
  sequence: number | undefined;
}

/** Seeds from the last-value cache at mount, then follows the live stream. */
export function useRealtimeTopic<T>(topic: string): RealtimeTopicState<T> {
  const [state, setState] = useState<RealtimeTopicState<T>>(() => {
    const cached = realtimeClient.getLastValue<T>(topic);
    return {
      value: cached?.value,
      stale: !!cached,
      receivedAt: cached?.receivedAt,
      source: cached?.source,
      sequence: cached?.sequence,
    };
  });

  useEffect(() => {
    return realtimeClient.subscribe(topic, (payload) => {
      const cached = realtimeClient.getLastValue<T>(topic);
      setState({
        value: payload as T,
        stale: false,
        receivedAt: cached?.receivedAt ?? Date.now(),
        source: cached?.source,
        sequence: cached?.sequence,
      });
    });
  }, [topic]);

  return state;
}

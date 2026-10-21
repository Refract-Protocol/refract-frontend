"use client";

import { useEffect, useRef } from "react";
import { realtimeClient } from "@/lib/realtime/client";

/** Declare interest in a topic; the shared client owns connection and teardown state. */
export function useRealtimeTopic<T = unknown>(
  topic: string | null | undefined,
  onMessage: (payload: T) => void
): void {
  const callback = useRef(onMessage);

  useEffect(() => {
    callback.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!topic) return;
    return realtimeClient.subscribe(topic, (payload) => callback.current(payload as T));
  }, [topic]);
}

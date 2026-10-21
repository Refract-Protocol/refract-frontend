"use client";
import { useEffect, useRef } from "react";
import { realtimeClient } from "@/lib/realtime/client";
import type { TopicPattern } from "@/lib/realtime/topics";
export function useRealtimeTopic(pattern: TopicPattern, handler: (payload: unknown) => void): void {
  const current = useRef(handler);
  current.current = handler;
  useEffect(
    () => realtimeClient.subscribe(pattern, (payload) => current.current(payload)),
    [pattern]
  );
}

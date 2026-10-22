"use client";
import { useEffect, useRef, useState } from "react";
import { realtimeClient } from "@/lib/realtime/client";
import { descriptor, type Interest, type Topic } from "@/lib/realtime/contract";
/** Stable descriptor identity and debounced acquisition; old interest stops immediately. */
export function useRealtimeTopic(
  topic: Topic,
  interest: Interest | null,
  handler: (payload: unknown) => void
) {
  const latest = useRef(handler);
  latest.current = handler;
  const key = interest ? JSON.stringify(descriptor(topic, interest)) : null;
  useEffect(() => {
    if (!key) return;
    let unsubscribe: (() => void) | undefined;
    const timer = setTimeout(() => {
      const d = JSON.parse(key) as ReturnType<typeof descriptor>;
      unsubscribe = realtimeClient.subscribe(
        d.topic,
        (payload) => latest.current(payload),
        d.interest
      );
    }, 150);
    return () => {
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [key]);
}

/** Fixed refresh window: continuous traffic cannot postpone REST refresh forever. */
export function useRealtimeRevision(topic: Topic, interest: Interest | null) {
  const [revision, setRevision] = useState(0);
  const pending = useRef<ReturnType<typeof setTimeout>>();
  useRealtimeTopic(topic, interest, () => {
    if (pending.current !== undefined) return;
    pending.current = setTimeout(() => {
      pending.current = undefined;
      setRevision((n) => n + 1);
    }, 100);
  });
  useEffect(() => () => clearTimeout(pending.current), []);
  return revision;
}

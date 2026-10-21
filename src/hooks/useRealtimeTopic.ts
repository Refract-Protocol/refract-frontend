"use client";

import { useEffect, useState } from "react";
import { realtimeClient } from "@/lib/realtime/client";
import type { MappingResult } from "@/lib/realtime/mappers";

/** Subscribe to a wire topic while exposing only its mapped domain value. */
export function useRealtimeTopic<T>(
  topic: string,
  map: (payload: unknown) => MappingResult<T>,
  onValue?: (value: T) => void,
  enabled = true
): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return realtimeClient.subscribe(topic, (payload) => {
      const result = map(payload);
      if (!result.ok) {
        console.warn(`[realtime] Dropped ${topic} payload: ${result.reason}`, payload);
        return;
      }
      setValue(result.value);
      onValue?.(result.value);
    });
  }, [topic, map, onValue, enabled]);
  return value;
}

import { useEffect, useRef, useState } from 'react';

export type RealtimeHealth = 'connecting' | 'healthy' | 'degraded' | 'offline';

export interface UseRealtimeHealthOptions {
  /** Milliseconds without a frame/heartbeat before the connection is considered degraded. */
  degradedAfterMs?: number;
  /** Milliseconds without a frame/heartbeat before the connection is considered offline. */
  offlineAfterMs?: number;
}

const DEFAULT_DEGRADED_AFTER_MS = 15_000;
const DEFAULT_OFFLINE_AFTER_MS = 45_000;

/**
 * Tracks realtime connection health based on the last observed frame or heartbeat.
 *
 * The hook reports `connecting` until the first frame/heartbeat is observed, then
 * transitions to `healthy`, `degraded`, or `offline` based on elapsed time.
 */
export function useRealtimeHealth(
  options: UseRealtimeHealthOptions = {},
): RealtimeHealth {
  const {
    degradedAfterMs = DEFAULT_DEGRADED_AFTER_MS,
    offlineAfterMs = DEFAULT_OFFLINE_AFTER_MS,
  } = options;

  const [health, setHealth] = useState<RealtimeHealth>('connecting');
  const lastSeenRef = useRef<number | null>(null);

  useEffect(() => {
    const evaluate = () => {
      const lastSeen = lastSeenRef.current;
      if (lastSeen === null) {
        setHealth('connecting');
        return;
      }

      const elapsed = Date.now() - lastSeen;
      if (elapsed >= offlineAfterMs) {
        setHealth('offline');
      } else if (elapsed >= degradedAfterMs) {
        setHealth('degraded');
      } else {
        setHealth('healthy');
      }
    };

    const markSeen = () => {
      lastSeenRef.current = Date.now();
      evaluate();
    };

    const handleMessage = () => markSeen();
    const handleHeartbeat = () => markSeen();

    window.addEventListener('message', handleMessage);
    window.addEventListener('realtime:heartbeat', handleHeartbeat);

    const interval = window.setInterval(evaluate, 1_000);
    evaluate();

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('realtime:heartbeat', handleHeartbeat);
      window.clearInterval(interval);
    };
  }, [degradedAfterMs, offlineAfterMs]);

  return health;
}

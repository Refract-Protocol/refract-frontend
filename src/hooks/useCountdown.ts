"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts down to `target` (ms epoch). Remaining time is clamped at zero and
 * `hasElapsed` flips to true once the target has passed. `onComplete` fires
 * exactly once when the countdown reaches zero.
 *
 * The initial remaining value is computed from `now` (defaults to `target`
 * offset) so server-rendered markup matches the first client render; the real
 * clock is only read inside effects.
 */
export function useCountdown(
  target: number,
  onComplete?: () => void,
): { remaining: number; hasElapsed: boolean } {
  const [remaining, setRemaining] = useState(() => Math.max(0, target - Date.now()));
  const [hasElapsed, setHasElapsed] = useState(() => target - Date.now() <= 0);
  const firedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    firedRef.current = false;

    const tick = () => {
      const next = Math.max(0, target - Date.now());
      setRemaining(next);
      if (next <= 0) {
        setHasElapsed(true);
        if (!firedRef.current) {
          firedRef.current = true;
          onCompleteRef.current?.();
        }
      } else {
        setHasElapsed(false);
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [target]);

  return { remaining, hasElapsed };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How long a connected wallet may sit with no user interaction before the
 * next sign-and-submit action requires a re-confirmation. Adjust here.
 */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/** Minimum gap between processed activity events, so mousemove doesn't thrash timers. */
export const ACTIVITY_THROTTLE_MS = 1000;

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "click", "touchstart", "scroll"] as const;

interface UseIdleTimerOptions {
  timeoutMs?: number;
  /** When false the timer is stopped and `idle` is false (e.g. no wallet connected). */
  enabled?: boolean;
}

/**
 * Tracks app-wide inactivity. Once `timeoutMs` passes with no interaction,
 * `idle` flips true and stays true — later activity does NOT clear it; only
 * `reset()` (called after the user re-confirms) does.
 */
export function useIdleTimer({ timeoutMs = IDLE_TIMEOUT_MS, enabled = true }: UseIdleTimerOptions = {}) {
  const [idle, setIdle] = useState(false);
  const idleRef = useRef(false);
  const lastActivity = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markIdle = useCallback(() => {
    idleRef.current = true;
    setIdle(true);
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(markIdle, timeoutMs);
  }, [markIdle, timeoutMs]);

  const reset = useCallback(() => {
    idleRef.current = false;
    setIdle(false);
    lastActivity.current = Date.now();
    schedule();
  }, [schedule]);

  useEffect(() => {
    if (!enabled) {
      if (timer.current) clearTimeout(timer.current);
      idleRef.current = false;
      setIdle(false);
      return;
    }

    lastActivity.current = Date.now();
    schedule();

    let lastEvent = 0;
    function onActivity() {
      if (idleRef.current) return;
      const now = Date.now();
      // A suspended tab/laptop can miss the timeout; catch it on the next event.
      if (now - lastActivity.current >= timeoutMs) {
        markIdle();
        return;
      }
      if (now - lastEvent < ACTIVITY_THROTTLE_MS) return;
      lastEvent = now;
      lastActivity.current = now;
      schedule();
    }

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, schedule, markIdle, timeoutMs]);

  return { idle, reset };
}

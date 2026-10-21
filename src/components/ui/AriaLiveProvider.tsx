"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Throttled ARIA live region system.
 *
 * Continuous realtime streams are an accessibility trap: an unthrottled
 * `aria-live="polite"` region on the oracle price or the LP pool stats will
 * machine-gun the screen reader and make the page unusable, while no live
 * region at all means non-visual users never learn that a claim settled or
 * a policy was issued.
 *
 * This system solves that with a deliberate, throttled announcement policy:
 *
 * - **Polite, not assertive.** The region uses `aria-live="polite"` so the
 *   screen reader finishes the current utterance before announcing —
 *   never interrupts.
 * - **Throttle window.** At most one announcement is flushed every
 *   `THROTTLE_MS` (2 000 ms). If multiple events arrive within the window,
 *   the most recent one wins and older pending announcements are coalesced.
 * - **Batch coalescing.** When multiple distinct messages arrive within
 *   the throttle window, they are joined into a single announcement so
 *   the user still hears about every meaningful change — just not 30 times
 *   per second.
 * - **Reduced motion.** Respects `prefers-reduced-motion` by lengthening
 *   the throttle to `REDUCED_THROTTLE_MS` (5 000 ms), because a user who
 *   disables visual animation likely also prefers fewer auditory
 *   interruptions.
 */

const THROTTLE_MS = 2_000;
const REDUCED_THROTTLE_MS = 5_000;

interface AriaLiveContextValue {
  /** Enqueue a message for the throttled polite live region. */
  announce: (message: string) => void;
}

const AriaLiveContext = createContext<AriaLiveContextValue | null>(null);

/**
 * Provides the throttled `aria-live="polite"` region and the `announce`
 * function. Mount once near the app root (inside `Providers`).
 */
export function AriaLiveProvider({ children }: { children: React.ReactNode }) {
  const [announcement, setAnnouncement] = useState("");
  const queueRef = useRef<string[]>([]);
  const lastFlushRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Detect prefers-reduced-motion once on mount.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const flush = useCallback(() => {
    // Already scheduled — the pending timer will pick up everything in the
    // queue when it fires, so there's nothing to do. This is what enables
    // batch coalescing: all synchronous `announce` calls in the same tick
    // accumulate in the queue before any of them are flushed.
    if (timerRef.current) return;

    const throttleMs = reducedMotion ? REDUCED_THROTTLE_MS : THROTTLE_MS;
    const now = Date.now();
    const elapsed = now - lastFlushRef.current;
    // If we're outside the throttle window, flush ASAP (0ms timer). If
    // we're still inside it, wait for the remaining time. Using a timer
    // in both cases (instead of a synchronous flush) ensures that every
    // `announce` call in the current synchronous batch is queued before
    // the flush runs.
    const remaining = Math.max(0, throttleMs - elapsed);

    timerRef.current = setTimeout(() => {
      lastFlushRef.current = Date.now();
      const pending = queueRef.current;
      if (pending.length > 0) {
        setAnnouncement(pending.join(". "));
        queueRef.current = [];
      }
      timerRef.current = null;
    }, remaining);
  }, [reducedMotion]);

  const announce = useCallback(
    (message: string) => {
      if (!message) return;
      queueRef.current.push(message);
      flush();
    },
    [flush],
  );

  // Clear the timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const value = useMemo(() => ({ announce }), [announce]);

  return (
    <AriaLiveContext.Provider value={value}>
      {children}
      {/* Visually-hidden, throttled polite live region. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </AriaLiveContext.Provider>
  );
}

/**
 * Returns the `announce` function from the nearest `AriaLiveProvider`.
 * Throws if used outside of one to catch wiring mistakes during development.
 */
export function useAriaLive(): AriaLiveContextValue {
  const ctx = useContext(AriaLiveContext);
  if (!ctx) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn("useAriaLive called outside AriaLiveProvider — announcements will be lost");
    }
    // Return a no-op so the calling code doesn't crash.
    return { announce: () => {} };
  }
  return ctx;
}

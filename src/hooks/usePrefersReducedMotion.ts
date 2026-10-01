"use client";

import { useEffect, useState } from "react";

import { usePreferencesStore } from "@/lib/store/preferencesStore";

/**
 * Tracks the user's prefers-reduced-motion setting, including live changes.
 *
 * Kept as the OS-only primitive: it reflects the reactive `matchMedia` query
 * and updates when the operating-system setting changes.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * Resolves whether motion should be reduced by composing the OS query with the
 * stored user override:
 *
 * - `system` (default): defer to the OS `prefers-reduced-motion` setting.
 * - `reduced`: always reduce motion, regardless of the OS setting.
 * - `full`: never reduce motion, regardless of the OS setting.
 */
export function useReducedMotion(): boolean {
  const systemReduced = usePrefersReducedMotion();
  const motion = usePreferencesStore((s) => s.motion);

  if (motion === "reduced") return true;
  if (motion === "full") return false;
  return systemReduced;
}
